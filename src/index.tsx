import { useEffect, useId, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { createCommandEngine } from './core.js';
import type { Command, CommandEngine, EngineSnapshot, EngineOptions, FinalContext, WorkflowProgress } from './core.js';
export * from './core.js';

/** Subscribe to a headless engine from React. The caller owns the engine's lifetime. */
export function useCommandEngine(engine: CommandEngine): { state: EngineSnapshot; actions: CommandEngine } {
  return { state: useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot), actions: engine };
}
export type CommandPaletteProps = Pick<EngineOptions, 'commands' | 'defaults' | 'callbacks' | 'strategies' | 'plugins'> & { open: boolean; onOpenChange: (open: boolean) => void; renderProgress?: (progress: WorkflowProgress) => ReactNode };

export function CommandPalette(props: CommandPaletteProps) {
  return props.open ? <OpenPalette {...props} /> : null;
}
function OpenPalette({ commands, defaults, callbacks, strategies, plugins, onOpenChange, renderProgress }: CommandPaletteProps) {
  const engine = useMemo(() => createCommandEngine({ commands, defaults, callbacks, strategies }), []);
  const { state, actions } = useCommandEngine(engine);
  const input = useRef<HTMLInputElement>(null), dialog = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null), keyboardNavigation = useRef(false);
  const listId = useId();
  const lifetimes = useRef(new Map<CommandEngine, number>());
  useLayoutEffect(() => { engine.setOptions({ commands, defaults, callbacks, strategies }); }, [engine, commands, defaults, callbacks, strategies]);
  useLayoutEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, [engine]);
  useEffect(() => {
    const lifetime = (lifetimes.current.get(engine) ?? 0) + 1;
    lifetimes.current.set(engine, lifetime);
    input.current?.focus();
    return () => {
      previousFocus.current?.focus();
      queueMicrotask(() => { if (lifetimes.current.get(engine) === lifetime) { engine.destroy(); lifetimes.current.delete(engine); } });
    };
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
  useEffect(() => { if (state.closed) onOpenChange(false); }, [state.closed, onOpenChange]);
  useLayoutEffect(() => {
    if (state.phase === 'final') dialog.current?.querySelector<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')?.focus();
    else input.current?.focus();
  }, [state.phase]);
  useLayoutEffect(() => {
    if (!state.loading && !state.running && state.items.length) document.getElementById(`${listId}-${state.active}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [state.loading, state.running, state.items, state.active, listId]);
  function back() { actions.back(); input.current?.focus(); }
  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && state.arrowNavigation && event.target === input.current && !state.query && !event.nativeEvent.isComposing && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      if (event.key === 'ArrowLeft' && state.canBack && !state.running) { event.preventDefault(); back(); }
      else if (event.key === 'ArrowRight' && state.canForward) { event.preventDefault(); actions.forward(); }
    } else if (event.key === 'Escape') { event.preventDefault(); if (state.canBack && !state.running) back(); else actions.close(); }
    else if (event.key === 'ArrowDown' && state.phase !== 'final') { event.preventDefault(); keyboardNavigation.current = true; actions.setActive(state.items.length ? (state.active + 1) % state.items.length : 0); }
    else if (event.key === 'ArrowUp' && state.phase !== 'final') { event.preventDefault(); keyboardNavigation.current = true; actions.setActive(state.items.length ? (state.active - 1 + state.items.length) % state.items.length : 0); }
    else if (event.key === 'Enter' && event.target === input.current) { event.preventDefault(); actions.select(state.active); }
    else if (event.key === 'Tab' && dialog.current) {
      const focusable = Array.from(dialog.current.querySelectorAll<HTMLElement>('input:not([disabled]), button:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }
  const start = state.canBack ? Math.floor(state.active / state.maxVisibleItems) * state.maxVisibleItems : 0;
  const visibleItems = state.canBack ? state.items.slice(start, start + state.maxVisibleItems) : state.items;
  const message = state.error instanceof Error ? state.error.message : state.error ? (state.loadFailed ? 'Could not load options' : 'Command failed') : null;
  const context: FinalContext = { answers: state.answers, summary: state.summary, status: state.status, error: state.error, result: state.result, execute: actions.execute, back, close: actions.close };
  return <div role="dialog" aria-modal="true" aria-label="Command palette" ref={dialog} onKeyDown={keyDown}>
    {state.phase === 'final' && state.finalStep ? <>
      {state.finalStep.render ? state.finalStep.render(context) as ReactNode : <>
        <dl>{state.summary.map(item => <div key={item.id}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
        {state.status === 'loading' && <p role="status">Running command…</p>}
        {message && <div role="alert">{message}</div>}
        {state.canBack && <button type="button" onClick={back} disabled={state.running}>Back</button>}
        {state.finalStep.timing === 'before' && <button type="button" onClick={() => void actions.execute()} disabled={state.running}>{state.status === 'error' ? 'Retry' : 'Confirm'}</button>}
        {state.finalStep.timing === 'after' && state.status === 'error' && <button type="button" onClick={() => void actions.execute()}>Retry</button>}
        <button type="button" onClick={actions.close}>Cancel</button>
      </>}
    </> : <>
      <label>{state.step?.label ?? (state.canBack ? state.menuLabel : 'Search commands')}<input ref={input} value={state.query} onChange={event => actions.setQuery(event.target.value)} role="combobox" aria-expanded="true" aria-controls={!state.loading && !state.running ? listId : undefined} aria-activedescendant={state.items.length && !state.loading && !state.running ? `${listId}-${state.active}` : undefined} aria-autocomplete="list" disabled={state.running} /></label>
      {state.canBack && <button type="button" onClick={back} disabled={state.running}>Back</button>}
      <button type="button" onClick={actions.close}>Cancel</button>
      {state.loading && <p role="status">Loading options…</p>}
      {state.running && <p role="status">Running command…</p>}
      {message && <div role="alert">{message}{(state.loadFailed || (state.phase === "final" && state.status === "error")) && <button type="button" onClick={actions.retry}>Retry</button>}</div>}
      {!state.loading && !state.running && <ul role="listbox" id={listId} aria-label={state.step?.label ?? state.menuLabel}>{visibleItems.map((item, offset) => { const i = start + offset; return <li key={'id' in item ? item.id : item.value} id={`${listId}-${i}`} role="option" aria-selected={i === state.active} aria-posinset={i + 1} aria-setsize={state.items.length} onMouseMove={event => { const previous = pointer.current; const moved = previous ? previous.x !== event.clientX || previous.y !== event.clientY : (event.movementX || 0) !== 0 || (event.movementY || 0) !== 0; pointer.current = { x: event.clientX, y: event.clientY }; if (!keyboardNavigation.current || moved) { keyboardNavigation.current = false; actions.setActive(i); } }} onClick={() => actions.select(i)}>{item.label}</li>; })}</ul>}
    </>}
    {state.progress && renderProgress?.(state.progress)}
  </div>;
}
