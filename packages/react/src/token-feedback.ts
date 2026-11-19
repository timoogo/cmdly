import { useEffect, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import type { Token, TokenFeedback } from '@cmdly/core';

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

/**
 * Polite announcement text. Each issue is announced once per status; the region is cleared when what it
 * says is no longer true, and an identical follow-up message is made distinct so it is announced again.
 */
export function useTokenAnnouncement(mode: 'banner' | 'loader' | 'none', feedback: TokenFeedback): string {
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
