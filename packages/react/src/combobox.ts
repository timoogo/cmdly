import { useId, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import type { CSSProperties, KeyboardEvent, RefObject } from 'react';
import type { CommandView, EngineSnapshot, FinalContext, Option, TokenFeedback } from '@cmdly/core';
import type { CommandSessionEngine } from './session.js';
import { useTokenAnnouncement, type TokenFeedbackMode } from './token-feedback.js';

export type CommandComboboxOptions = {
  /** Token feedback: `'banner'` (default) and `'loader'` also announce issues through `tokens.announcer`. */
  tokenFeedback?: TokenFeedbackMode;
  /**
   * Leaves the interface (Escape at the root, Cancel, the final step's `close`). Defaults to `engine.close()`,
   * which ends the session for good; pass a UI-only dismissal to keep an externally owned session alive.
   */
  onDismiss?: () => void;
};

const visuallyHidden: CSSProperties = { position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', border: 0 };

const finalFocusable = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/**
 * Headless behaviour of a command session view: keyboard interaction (arrows, Enter, Escape back/dismiss),
 * ARIA wiring, pointer/keyboard active-item arbitration, input and final-step focus, and token feedback.
 * Spread `rootProps` on the element containing the view, `inputProps` on the input, `listboxProps` and
 * `getOptionProps(index)` on the list, and render `tokens.announcer` when it is set. Rendering, styling and
 * the surrounding container (dialog, popover, page section) are yours; Tab is never handled.
 *
 * The engine is a session from `useCommandSession` (closed by `dismiss`) or one you created and keep
 * (pass `onDismiss` to hide your interface without closing it).
 */
export function useCommandCombobox(engine: CommandSessionEngine, { tokenFeedback = 'banner', onDismiss }: CommandComboboxOptions = {}): CommandCombobox {
  const state: EngineSnapshot<CommandView> = useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot), actions = engine;
  const root = useRef<HTMLElement | null>(null);
  const setRoot = useRef((node: HTMLElement | null) => { root.current = node; }).current;
  const dismiss = onDismiss ?? actions.close;
  const input = useRef<HTMLInputElement>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null), keyboardNavigation = useRef(false);
  const listId = useId(), feedbackId = useId();
  useLayoutEffect(() => {
    if (state.phase === 'final') root.current?.querySelector<HTMLElement>(finalFocusable)?.focus();
    else input.current?.focus();
  }, [state.phase]);
  useLayoutEffect(() => {
    if (!state.loading && !state.running && state.items.length) document.getElementById(`${listId}-${state.active}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [state.loading, state.running, state.items, state.active, listId]);

  function back() { actions.back(); input.current?.focus(); }
  /** Handles every key except Tab, whose containment depends on the container. */
  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && state.arrowNavigation && event.target === input.current && !state.query && !event.nativeEvent.isComposing && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      if (event.key === 'ArrowLeft' && state.canBack && !state.running) { event.preventDefault(); back(); }
      else if (event.key === 'ArrowRight' && state.canForward) { event.preventDefault(); actions.forward(); }
    } else if (event.key === 'Escape') { event.preventDefault(); if (state.canBack && !state.running) back(); else dismiss(); }
    else if (event.key === 'ArrowDown' && state.phase !== 'final') { event.preventDefault(); keyboardNavigation.current = true; actions.setActive(state.items.length ? (state.active + 1) % state.items.length : 0); }
    else if (event.key === 'ArrowUp' && state.phase !== 'final') { event.preventDefault(); keyboardNavigation.current = true; actions.setActive(state.items.length ? (state.active - 1 + state.items.length) % state.items.length : 0); }
    else if (event.key === 'Enter' && event.target === input.current) { event.preventDefault(); actions.select(state.active); }
  }

  const start = state.canBack ? Math.floor(state.active / state.maxVisibleItems) * state.maxVisibleItems : 0;
  const visibleItems = (state.canBack ? state.items.slice(start, start + state.maxVisibleItems) : state.items).map((item, offset) => ({ item, index: start + offset }));
  const message = state.error instanceof Error ? state.error.message : state.error ? (state.loadFailed ? 'Could not load options' : 'Command failed') : null;

  // Regions are mounted as soon as tokens are possible (and stay mounted) so that live regions exist before their first message.
  const tokensSeen = useRef(false);
  if (state.tokensEnabled) tokensSeen.current = true;
  const feedback = state.tokenFeedback, showFeedback = tokensSeen.current;
  const builtIn = tokenFeedback === 'banner' || tokenFeedback === 'loader';
  const announcement = useTokenAnnouncement(builtIn && showFeedback ? tokenFeedback : 'none', feedback);
  const bannerVisible = tokenFeedback === 'banner' && (feedback.issues.length > 0 || feedback.pending.length > 0);
  const busy = tokenFeedback === 'loader' && feedback.pending.length > 0;
  const listVisible = !state.loading && !state.running;

  const finalContext: FinalContext = { answers: state.answers, summary: state.summary, status: state.status, error: state.error, result: state.result, execute: () => actions.execute(), back, close: dismiss };
  const inputProps = {
    ref: input, value: state.query, onChange: (event: { target: { value: string } }) => actions.setQuery(event.target.value),
    role: 'combobox' as const, 'aria-expanded': true as const, 'aria-controls': listVisible ? listId : undefined,
    'aria-activedescendant': state.items.length && listVisible ? `${listId}-${state.active}` : undefined, 'aria-autocomplete': 'list' as const,
    'aria-describedby': bannerVisible ? feedbackId : undefined, readOnly: state.running, 'aria-disabled': state.running || undefined,
  };
  const listboxProps = { role: 'listbox' as const, id: listId, 'aria-label': state.step?.label ?? state.menuLabel, 'aria-busy': busy || undefined };
  const getOptionProps = (index: number) => ({
    id: `${listId}-${index}`, role: 'option' as const, 'aria-selected': index === state.active, 'aria-posinset': index + 1, 'aria-setsize': state.items.length,
    onMouseMove: (event: { clientX: number; clientY: number; movementX?: number; movementY?: number }) => {
      const previous = pointer.current;
      const moved = previous ? previous.x !== event.clientX || previous.y !== event.clientY : (event.movementX || 0) !== 0 || (event.movementY || 0) !== 0;
      pointer.current = { x: event.clientX, y: event.clientY };
      if (!keyboardNavigation.current || moved) { keyboardNavigation.current = false; actions.setActive(index); }
    },
    onClick: () => actions.select(index),
  });

  const announcer = builtIn && showFeedback ? { role: 'status' as const, 'aria-live': 'polite' as const, 'data-cmdly-token-announcer': '' as const, style: visuallyHidden, children: announcement } : null;

  return {
    state, actions, back, dismiss, rootProps: { ref: setRoot, onKeyDown }, inputProps, listboxProps, getOptionProps, listVisible,
    visibleItems: visibleItems as { item: CommandView | Option; index: number }[], message, finalContext,
    tokens: { feedback, showFeedback, announcer, bannerVisible, feedbackId, busy, mode: tokenFeedback },
  };
}

/** Everything a custom session view needs; returned by `useCommandCombobox`. */
export type CommandCombobox = {
  /** Engine snapshot: phase, query, items, active index, step, loading/running, error, progress, final step… */
  state: EngineSnapshot<CommandView>;
  /** The engine's actions (`select`, `setQuery`, `setActive`, `execute`, `retry`, `forward`…). */
  actions: CommandSessionEngine;
  /** Previous step, keeping focus in the input. */
  back: () => void;
  /** Leaves the interface: `onDismiss` when given, otherwise `engine.close()` (definitive). */
  dismiss: () => void;
  /** For the element containing the view: keyboard handling (every key except Tab) and final-step focus. */
  rootProps: { ref: (node: HTMLElement | null) => void; onKeyDown: (event: KeyboardEvent<HTMLElement>) => void };
  /** For the text input: value, change handler, combobox ARIA, initial and per-step focus. Add an accessible name. */
  inputProps: {
    ref: RefObject<HTMLInputElement | null>; value: string; onChange: (event: { target: { value: string } }) => void;
    role: 'combobox'; 'aria-expanded': true; 'aria-controls': string | undefined; 'aria-activedescendant': string | undefined;
    'aria-autocomplete': 'list'; 'aria-describedby': string | undefined; readOnly: boolean; 'aria-disabled': true | undefined;
  };
  /** For the list element; render it only when `listVisible`. */
  listboxProps: { role: 'listbox'; id: string; 'aria-label': string; 'aria-busy': true | undefined };
  /** For each item of `visibleItems`, by its `index`: ARIA, pointer activation and selection. */
  getOptionProps: (index: number) => {
    id: string; role: 'option'; 'aria-selected': boolean; 'aria-posinset': number; 'aria-setsize': number;
    onMouseMove: (event: { clientX: number; clientY: number; movementX?: number; movementY?: number }) => void;
    onClick: () => void;
  };
  /** `false` while loading or running. */
  listVisible: boolean;
  /** Items to render with their index in `state.items` (paged in steps by `maxVisibleItems`). */
  visibleItems: { item: CommandView | Option; index: number }[];
  /** Readable error message, or `null`. */
  message: string | null;
  /** Context for the final phase: pass it to `state.finalStep.render`, or use it for your own summary. */
  finalContext: FinalContext;
  tokens: {
    /** Live token feedback (`issues`, `pending`, `status`). */
    feedback: TokenFeedback;
    /** Token parsing is possible in this session: render token feedback from now on. */
    showFeedback: boolean;
    /** Props for a visually hidden polite live region announcing token issues; `null` when none should be mounted. */
    announcer: { role: 'status'; 'aria-live': 'polite'; 'data-cmdly-token-announcer': ''; style: CSSProperties; children: string } | null;
    /** The built-in banner has content; render it with `id={feedbackId}` (referenced by the input). */
    bannerVisible: boolean;
    feedbackId: string;
    /** Validation pending in `'loader'` mode. */
    busy: boolean;
    mode: TokenFeedbackMode;
  };
};
