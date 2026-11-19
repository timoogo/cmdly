import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { createCommandEngine } from '@cmdly/core';
import type { CommandEngine, CommandView, EngineCallbacks, EngineOptions } from '@cmdly/core';

export type CommandSessionOptions = Pick<EngineOptions, 'commands' | 'defaults' | 'callbacks' | 'strategies' | 'plugins' | 'tokens'>;

/** Engine operations an interface needs to display a session; satisfied by plain and registry engines. */
export type SessionEngine = Pick<CommandEngine<CommandView, any>, 'getSnapshot' | 'subscribe' | 'select' | 'back' | 'forward' | 'setQuery' | 'setActive' | 'retry' | 'execute' | 'close'>;

/**
 * Owns one engine — one session — for the lifetime of the calling component: creates it on mount, keeps
 * its options in sync, sets up plugins and destroys it on unmount (a StrictMode remount keeps it alive).
 * Mount the component when your interface opens; a closed session (Escape at the root, Cancel, completion)
 * calls `callbacks.onClose` and cannot be reopened. To keep a session across openings, create the engine
 * yourself with `createCommandEngine` instead.
 *
 * `callbacks` may be inline. `commands`, `defaults`, `strategies` and `tokens` are re-applied when their
 * identity changes: in the component that also renders the session, keep them stable (module constants,
 * `useMemo`), or each render reconfigures the session.
 */
export function useCommandSession({ commands, defaults, callbacks, strategies, plugins, tokens }: CommandSessionOptions): CommandEngine {
  // Callbacks are read through a stable delegate: inline callbacks neither re-configure nor re-render the session.
  const latestCallbacks = useRef(callbacks);
  useLayoutEffect(() => { latestCallbacks.current = callbacks; });
  const engine = useMemo(() => {
    const delegate: EngineCallbacks = {
      onNavigate: (...args) => latestCallbacks.current?.onNavigate?.(...args),
      onExecute: (...args) => latestCallbacks.current?.onExecute?.(...args),
      onError: (...args) => latestCallbacks.current?.onError?.(...args),
      onClose: (...args) => latestCallbacks.current?.onClose?.(...args),
    };
    return createCommandEngine({ commands, defaults, callbacks: delegate, strategies, tokens });
  }, []);
  const appliedTokens = useRef(tokens);
  useLayoutEffect(() => { if (appliedTokens.current !== tokens) { appliedTokens.current = tokens; engine.setOptions({ tokens: tokens ?? { types: [] } }); } }, [engine, tokens]);
  const lifetimes = useRef(new Map<CommandEngine, number>());
  const applied = useRef({ commands, defaults, strategies });
  useLayoutEffect(() => {
    const previous = applied.current;
    if (previous.commands === commands && previous.defaults === defaults && previous.strategies === strategies) return;
    applied.current = { commands, defaults, strategies };
    engine.setOptions({ commands, defaults, strategies });
  }, [engine, commands, defaults, strategies]);
  useEffect(() => {
    const lifetime = (lifetimes.current.get(engine) ?? 0) + 1;
    lifetimes.current.set(engine, lifetime);
    // Deferred so that a StrictMode unmount/remount does not destroy the live engine.
    return () => queueMicrotask(() => { if (lifetimes.current.get(engine) === lifetime) { engine.destroy(); lifetimes.current.delete(engine); } });
  }, [engine]);
  useEffect(() => {
    const cleanups: (() => void)[] = [];
    const cleanupAll = () => {
      let firstError: unknown, failed = false;
      for (const cleanup of cleanups.reverse()) {
        try { cleanup(); } catch (error) { if (!failed) firstError = error; failed = true; }
      }
      if (failed) throw firstError;
    };
    try {
      for (const plugin of plugins ?? []) {
        const cleanup = plugin.setup(engine);
        if (cleanup) cleanups.push(cleanup);
      }
    } catch (error) {
      try { cleanupAll(); } catch (cleanupError) { throw new Error(`Plugin setup failed (${String(error)}); cleanup also failed (${String(cleanupError)})`); }
      throw error;
    }
    return cleanupAll;
  }, [engine, plugins]);
  return engine;
}

/**
 * Internal. Calls `onClosed` once the engine reports `closed` (definitive in the core), whoever owns it.
 * Keep `onClosed` stable (e.g. `useCallback`): it is an effect dependency.
 */
export function useClosedEngine(engine: SessionEngine, onClosed: () => void): void {
  const closed = useSyncExternalStore(engine.subscribe, () => engine.getSnapshot().closed, () => engine.getSnapshot().closed);
  useEffect(() => { if (closed) onClosed(); }, [closed, onClosed]);
}
