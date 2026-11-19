import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ComponentType, KeyboardEvent, ReactNode } from 'react';
import { createCommandEngine } from '@cmdly/core';
import type { Command, CommandView, CommandEngine, RegistryCommandEngine, RegistryRuntime, EngineSnapshot, EngineOptions, FinalContext, WorkflowProgress, ResolvedTagDefinition, TagDefinition, CommandRegistry, Token, TokenFeedback, TokenOptions } from '@cmdly/core';
export * from '@cmdly/core';

/**
 * Resolve the display definition for a tag on a command view.
 * Merges command-level `tagOverrides` over the provided catalog entry.
 *
 * @example
 * const def = resolveTagDisplay('search', command, registry.tagCatalog);
 */
export function resolveTagDisplay(
  tag: string,
  command: CommandView,
  catalog: Readonly<Record<string, TagDefinition>>,
): ResolvedTagDefinition {
  const catalogDef: TagDefinition = catalog[tag] ?? {};
  const override = (command as CommandView & { tagOverrides?: Record<string, Partial<TagDefinition>> }).tagOverrides?.[tag] ?? {};
  return { key: tag, ...catalogDef, ...override };
}

/** Subscribe to a headless engine from React. The caller owns the engine's lifetime. */
export function useCommandEngine<TRuntime, TRuntimeRequired extends boolean>(engine: RegistryCommandEngine<TRuntime, TRuntimeRequired>): { state: EngineSnapshot<CommandView, RegistryRuntime<TRuntime>>; actions: RegistryCommandEngine<TRuntime, TRuntimeRequired> };
export function useCommandEngine(engine: CommandEngine): { state: EngineSnapshot; actions: CommandEngine };
export function useCommandEngine(input: unknown): unknown {
  const engine = input as CommandEngine<CommandView>;
  return { state: useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot), actions: engine };
}
/** Props received by a custom token feedback component. */
export type TokenFeedbackProps = { feedback: TokenFeedback; tokens: Token[] };
/**
 * Global token feedback mode of `CommandPalette`.
 * - `'banner'` (default): lists invalid, failed and ambiguous tokens and the validation in progress.
 * - `'loader'`: shows a global indicator while tokens are pending.
 * - `'none'`: renders nothing; read `state.tokenFeedback` from `useCommandEngine` instead.
 * - a component: receives `{ feedback, tokens }` and owns its accessibility.
 */
export type TokenFeedbackMode = 'banner' | 'loader' | 'none' | ComponentType<TokenFeedbackProps>;

/** Default, unstyled description of a token issue. */
export function describeTokenIssue(token: Token): string {
  if (token.message) return token.message;
  if (token.status === 'ambiguous') return `"${token.raw}" is ambiguous (${token.candidates.join(', ')})`;
  if (token.status === 'error') return `"${token.raw}" could not be validated`;
  return `"${token.raw}" is not valid`;
}

export type CommandPaletteProps = Pick<EngineOptions, 'commands' | 'defaults' | 'callbacks' | 'strategies' | 'plugins'> & {
  /** Global token types and collision resolver. Changes are applied to the open palette. */
  tokens?: TokenOptions;
  /** Global token feedback. Defaults to `'banner'`. */
  tokenFeedback?: TokenFeedbackMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  renderProgress?: (progress: WorkflowProgress) => ReactNode;
  /**
   * Custom tag badge renderer. Called for each tag on each command item.
   * When omitted, no tag badges are rendered by default (headless).
   *
   * @param tag - The tag key string.
   * @param definition - Resolved tag definition (merged catalog + command overrides).
   * @param command - The command view the tag belongs to.
   *
   * @example
   * renderTag={(tag, def) => (
   *   <span className={def.className} style={{ color: def.color }}>{def.label ?? tag}</span>
   * )}
   */
  renderTag?: (tag: string, definition: ResolvedTagDefinition, command: CommandView) => ReactNode;
};

export function CommandPalette(props: CommandPaletteProps) {
  return props.open ? <OpenPalette {...props} /> : null;
}
function OpenPalette({ commands, defaults, callbacks, strategies, plugins, tokens, tokenFeedback = 'banner', onOpenChange, renderProgress, renderTag }: CommandPaletteProps) {
  const engine = useMemo(() => createCommandEngine({ commands, defaults, callbacks, strategies, tokens }), []);
  const appliedTokens = useRef(tokens);
  useLayoutEffect(() => { if (appliedTokens.current !== tokens) { appliedTokens.current = tokens; engine.setOptions({ tokens: tokens ?? { types: [] } }); } }, [engine, tokens]);
  const { state, actions } = useCommandEngine(engine);
  const input = useRef<HTMLInputElement>(null), dialog = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null), keyboardNavigation = useRef(false);
  const listId = useId(), feedbackId = useId();
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
  // Regions are mounted as soon as tokens are possible (and stay mounted) so that live regions exist before their first message.
  const tokensSeen = useRef(false);
  if (tokens !== undefined || state.tokensEnabled) tokensSeen.current = true;
  const feedback = state.tokenFeedback, showFeedback = tokensSeen.current;
  const builtIn = tokenFeedback === 'banner' || tokenFeedback === 'loader';
  const announcement = useTokenAnnouncement(builtIn && showFeedback ? tokenFeedback : 'none', feedback);
  const bannerVisible = tokenFeedback === 'banner' && (feedback.issues.length > 0 || feedback.pending.length > 0);
  const busy = tokenFeedback === 'loader' && feedback.pending.length > 0;
  const CustomFeedback = typeof tokenFeedback === 'function' ? tokenFeedback : undefined;
  const tokenView = <>
    {builtIn && showFeedback && <span data-cmdly-token-announcer role="status" aria-live="polite" style={visuallyHidden}>{announcement}</span>}
    {bannerVisible && <div id={feedbackId} data-cmdly-token-feedback="banner" data-status={feedback.status}>
      {feedback.issues.map(token => <p key={token.id} data-status={token.status}>{describeTokenIssue(token)}</p>)}
      {feedback.pending.length > 0 && <p data-status="pending">Validating…</p>}
    </div>}
    {busy && <div data-cmdly-token-feedback="loader" data-status="pending">Validating…</div>}
    {CustomFeedback && showFeedback && <CustomFeedback feedback={feedback} tokens={state.tokens} />}
  </>;
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
      <label>{state.step?.label ?? (state.canBack ? state.menuLabel : 'Search commands')}<input ref={input} value={state.query} onChange={event => actions.setQuery(event.target.value)} role="combobox" aria-expanded="true" aria-controls={!state.loading && !state.running ? listId : undefined} aria-activedescendant={state.items.length && !state.loading && !state.running ? `${listId}-${state.active}` : undefined} aria-autocomplete="list" aria-describedby={bannerVisible ? feedbackId : undefined} disabled={state.running} /></label>
      {state.canBack && <button type="button" onClick={back} disabled={state.running}>Back</button>}
      <button type="button" onClick={actions.close}>Cancel</button>
      {state.loading && <p role="status">Loading options…</p>}
      {state.running && <p role="status">Running command…</p>}
      {message && <div role="alert">{message}{(state.loadFailed || (state.phase === "final" && state.status === "error")) && <button type="button" onClick={actions.retry}>Retry</button>}</div>}
      {!state.loading && !state.running && <ul role="listbox" id={listId} aria-label={state.step?.label ?? state.menuLabel} aria-busy={busy || undefined}>{visibleItems.map((item, offset) => { const i = start + offset; return <li key={'id' in item ? item.id : item.value} id={`${listId}-${i}`} role="option" aria-selected={i === state.active} aria-posinset={i + 1} aria-setsize={state.items.length} onMouseMove={event => { const previous = pointer.current; const moved = previous ? previous.x !== event.clientX || previous.y !== event.clientY : (event.movementX || 0) !== 0 || (event.movementY || 0) !== 0; pointer.current = { x: event.clientX, y: event.clientY }; if (!keyboardNavigation.current || moved) { keyboardNavigation.current = false; actions.setActive(i); } }} onClick={() => actions.select(i)}>{item.label}{renderTag && 'id' in item && (item as CommandView).tags?.map(tag => { const def: ResolvedTagDefinition = { key: tag, ...((item as CommandView & { tagOverrides?: Record<string, Partial<TagDefinition>> }).tagOverrides?.[tag] ?? {}) }; return <span key={tag}>{renderTag(tag, def, item as CommandView)}</span>; })}</li>; })}</ul>}
    </>}
    {tokenView}
    {state.progress && renderProgress?.(state.progress)}
  </div>;
}

const visuallyHidden = { position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', border: 0 } as const;

/**
 * Polite announcement text. Each issue is announced once per status; the region is cleared when what it
 * says is no longer true, and an identical follow-up message is made distinct so it is announced again.
 */
function useTokenAnnouncement(mode: 'banner' | 'loader' | 'none', feedback: TokenFeedback): string {
  const [message, setMessage] = useState('');
  const announced = useRef(new Set<string>()), spoken = useRef(new Set<string>()), wasPending = useRef(false);
  useEffect(() => {
    if (mode === 'none') return;
    const pending = feedback.pending.length > 0;
    let next: string | undefined;
    if (mode === 'loader') {
      if (pending && !wasPending.current) next = 'Validating…';
      else if (!pending && wasPending.current) next = '';
    } else {
      const keys = feedback.issues.map(token => `${token.id}:${token.status}`);
      const fresh = feedback.issues.filter((_, i) => !announced.current.has(keys[i]));
      announced.current = new Set(keys);
      if (fresh.length) { next = fresh.map(describeTokenIssue).join('. '); spoken.current = new Set(fresh.map(token => `${token.id}:${token.status}`)); }
      else if (![...spoken.current].some(key => announced.current.has(key))) { next = ''; spoken.current = new Set(); }
    }
    wasPending.current = pending;
    if (next !== undefined) { const text = next; setMessage(previous => text && previous.replace(/\u00a0$/, '') === text ? (previous.endsWith('\u00a0') ? text : `${text}\u00a0`) : text); }
  }, [mode, feedback]);
  return message;
}
