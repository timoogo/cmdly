import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import type { CommandView, EngineOptions, ResolvedTagDefinition, TokenOptions, WorkflowProgress } from '@cmdly/core';
import { useCommandSession } from './session.js';
import { useCommandCombobox } from './combobox.js';
import { CommandSessionView } from './session-view.js';
import type { TokenFeedbackMode } from './token-feedback.js';

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

const tabbable = 'input:not([disabled]), button:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

export function CommandPalette(props: CommandPaletteProps) {
  return props.open ? <OpenPalette {...props} /> : null;
}

/** Modal container: one session per opening, initial focus, Tab containment and focus restoration. */
function OpenPalette({ commands, defaults, callbacks, strategies, plugins, tokens, tokenFeedback = 'banner', onOpenChange, renderProgress, renderTag }: CommandPaletteProps) {
  const onClosed = useCallback(() => onOpenChange(false), [onOpenChange]);
  const engine = useCommandSession({ commands, defaults, callbacks, strategies, plugins, tokens, onClosed });
  const dialog = useRef<HTMLDivElement>(null), previousFocus = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, [engine]);
  const combobox = useCommandCombobox(engine, { root: dialog, tokensConfigured: tokens !== undefined, tokenFeedback });
  const input = combobox.inputProps.ref;
  useEffect(() => {
    input.current?.focus();
    return () => { previousFocus.current?.focus(); };
  }, [engine]);
  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Tab') { combobox.onKeyDown(event); return; }
    if (!dialog.current) return;
    const focusable = Array.from(dialog.current.querySelectorAll<HTMLElement>(tabbable));
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  return <div role="dialog" aria-modal="true" aria-label="Command palette" ref={dialog} onKeyDown={keyDown}>
    <CommandSessionView combobox={combobox} renderProgress={renderProgress} renderTag={renderTag} />
  </div>;
}
