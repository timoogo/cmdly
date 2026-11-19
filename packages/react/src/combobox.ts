import { useId, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import type { KeyboardEvent, RefObject } from 'react';
import type { CommandView, FinalContext, Option } from '@cmdly/core';
import type { SessionEngine } from './session.js';
import { useTokenAnnouncement, type TokenFeedbackMode } from './token-feedback.js';

export type CommandComboboxOptions = {
  /** Element containing the whole view; used to focus the final-step controls. */
  root: RefObject<HTMLElement | null>;
  /** Token types are configured by the host; live regions are mounted from the start. */
  tokensConfigured: boolean;
  tokenFeedback: TokenFeedbackMode;
  /**
   * Leaves the interface (Escape at the root, Cancel, the final step's `close`). Defaults to `engine.close()`,
   * which ends the session for good; pass a UI-only dismissal to keep an externally owned session alive.
   */
  onDismiss?: () => void;
};

const finalFocusable = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/**
 * Internal. Headless behaviour of a command session view: keyboard interaction, ARIA wiring,
 * pointer/keyboard active-item arbitration, step/final-phase focus and token feedback state.
 * Rendering and the surrounding container (modal, popover…) belong to the caller.
 */
export function useCommandCombobox(engine: SessionEngine, { root, tokensConfigured, tokenFeedback, onDismiss }: CommandComboboxOptions) {
  const state = useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot), actions = engine;
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
  if (tokensConfigured || state.tokensEnabled) tokensSeen.current = true;
  const feedback = state.tokenFeedback, showFeedback = tokensSeen.current;
  const builtIn = tokenFeedback === 'banner' || tokenFeedback === 'loader';
  const announcement = useTokenAnnouncement(builtIn && showFeedback ? tokenFeedback : 'none', feedback);
  const bannerVisible = tokenFeedback === 'banner' && (feedback.issues.length > 0 || feedback.pending.length > 0);
  const busy = tokenFeedback === 'loader' && feedback.pending.length > 0;
  const listVisible = !state.loading && !state.running;

  const finalContext: FinalContext = { answers: state.answers, summary: state.summary, status: state.status, error: state.error, result: state.result, execute: () => actions.execute(), back, close: dismiss };
  const inputProps = {
    ref: input, value: state.query, onChange: (event: { target: { value: string } }) => actions.setQuery(event.target.value),
    role: 'combobox', 'aria-expanded': true as const, 'aria-controls': listVisible ? listId : undefined,
    'aria-activedescendant': state.items.length && listVisible ? `${listId}-${state.active}` : undefined, 'aria-autocomplete': 'list' as const,
    'aria-describedby': bannerVisible ? feedbackId : undefined, readOnly: state.running, 'aria-disabled': state.running || undefined,
  };
  const listboxProps = { role: 'listbox', id: listId, 'aria-label': state.step?.label ?? state.menuLabel, 'aria-busy': busy || undefined };
  const getOptionProps = (index: number) => ({
    id: `${listId}-${index}`, role: 'option', 'aria-selected': index === state.active, 'aria-posinset': index + 1, 'aria-setsize': state.items.length,
    onMouseMove: (event: { clientX: number; clientY: number; movementX?: number; movementY?: number }) => {
      const previous = pointer.current;
      const moved = previous ? previous.x !== event.clientX || previous.y !== event.clientY : (event.movementX || 0) !== 0 || (event.movementY || 0) !== 0;
      pointer.current = { x: event.clientX, y: event.clientY };
      if (!keyboardNavigation.current || moved) { keyboardNavigation.current = false; actions.setActive(index); }
    },
    onClick: () => actions.select(index),
  });

  return {
    state, actions, back, dismiss, onKeyDown, inputProps, listboxProps, getOptionProps, listVisible,
    visibleItems: visibleItems as { item: CommandView | Option; index: number }[], message, finalContext,
    tokens: { feedback, showFeedback, builtIn, announcement, bannerVisible, busy, feedbackId, mode: tokenFeedback },
  };
}

export type CommandCombobox = ReturnType<typeof useCommandCombobox>;
