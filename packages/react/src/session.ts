import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { createCommandEngine } from '@cmdly/core';
import type { CommandEngine, EngineOptions } from '@cmdly/core';

export type CommandSessionOptions = Pick<EngineOptions, 'commands' | 'defaults' | 'callbacks' | 'strategies' | 'plugins' | 'tokens'> & {
  /** Called once the engine reports `closed`. Keep it stable (e.g. `useCallback`): it is an effect dependency. */
  onClosed: () => void;
};

/**
 * Internal. Owns one engine — one session — for the lifetime of the calling component:
 * creates it on mount, keeps its options in sync, sets up plugins, reports closing and
 * destroys it on unmount (a StrictMode remount keeps the same engine alive).
 */
export function useCommandSession({ commands, defaults, callbacks, strategies, plugins, tokens, onClosed }: CommandSessionOptions): CommandEngine {
  const engine = useMemo(() => createCommandEngine({ commands, defaults, callbacks, strategies, tokens }), []);
  const appliedTokens = useRef(tokens);
  useLayoutEffect(() => { if (appliedTokens.current !== tokens) { appliedTokens.current = tokens; engine.setOptions({ tokens: tokens ?? { types: [] } }); } }, [engine, tokens]);
  const lifetimes = useRef(new Map<CommandEngine, number>());
  useLayoutEffect(() => { engine.setOptions({ commands, defaults, callbacks, strategies }); }, [engine, commands, defaults, callbacks, strategies]);
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
  const closed = useSyncExternalStore(engine.subscribe, () => engine.getSnapshot().closed, () => engine.getSnapshot().closed);
  useEffect(() => { if (closed) onClosed(); }, [closed, onClosed]);
  return engine;
}
