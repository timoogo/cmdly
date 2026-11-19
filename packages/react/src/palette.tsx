import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import type { CommandView, EngineOptions, ResolvedTagDefinition, TokenOptions, WorkflowProgress } from '@cmdly/core';
import { useClosedEngine, useCommandSession, type SessionEngine } from './session.js';
import { useCommandCombobox } from './combobox.js';
import { CommandSessionView } from './session-view.js';
import type { TokenFeedbackMode } from './token-feedback.js';

export type PaletteViewProps = {
  /** Global token feedback. Defaults to `'banner'`. */
  tokenFeedback?: TokenFeedbackMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Accessible name of the dialog. Defaults to `'Command palette'`. */
  label?: string;
  /** `id` of the dialog element, e.g. for a trigger's `aria-controls`. */
  id?: string;
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

/** The palette creates one engine per opening from these options and destroys it when it closes. */
export type OwnedEngineProps = Pick<EngineOptions, 'commands' | 'defaults' | 'callbacks' | 'strategies' | 'plugins'> & {
  /** Global token types and collision resolver. Changes are applied to the open palette. */
  tokens?: TokenOptions;
  engine?: never;
};

/**
 * The palette displays a session owned by the caller (plain or registry engine). It never closes or destroys it:
 * Escape, Cancel and the final step's `close` only call `onOpenChange(false)`, and the session — query, path,
 * tokens, a running command — is kept for the next interface. Configure the engine itself (commands, tokens,
 * callbacks, plugins; `refreshRegistry()` after registry changes). When the engine closes (`engine.close()`,
 * completion), `onOpenChange(false)` is called and the engine cannot be shown again: create a new one.
 */
export type ExternalEngineProps = {
  /** A plain engine (`createCommandEngine({ commands })`) or a registry engine (`createCommandEngine({ registry })`). */
  engine: SessionEngine;
  commands?: never; defaults?: never; callbacks?: never; strategies?: never; plugins?: never; tokens?: never;
};

export type CommandPaletteProps = PaletteViewProps & (OwnedEngineProps | ExternalEngineProps);

const tabbable = 'input:not([disabled]), button:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

export function CommandPalette(props: CommandPaletteProps) {
  if (!props.open) return null;
  return props.engine ? <ExternalPalette {...props} engine={props.engine} /> : <OwnedPalette {...props as PaletteViewProps & OwnedEngineProps} />;
}

function OwnedPalette({ commands, defaults, callbacks, strategies, plugins, tokens, ...view }: PaletteViewProps & OwnedEngineProps) {
  const engine = useCommandSession({ commands, defaults, callbacks, strategies, plugins, tokens });
  return <PaletteSurface {...view} engine={engine} tokensConfigured={tokens !== undefined} />;
}

function ExternalPalette({ engine, onOpenChange, ...view }: PaletteViewProps & { engine: SessionEngine }) {
  const dismiss = useCallback(() => onOpenChange(false), [onOpenChange]);
  return <PaletteSurface {...view} onOpenChange={onOpenChange} engine={engine} tokensConfigured={false} onDismiss={dismiss} />;
}

/** Modal container: initial focus, Tab containment and focus restoration around one session view. */
function PaletteSurface({ engine, tokensConfigured, onDismiss, tokenFeedback = 'banner', onOpenChange, label = 'Command palette', id, renderProgress, renderTag }: PaletteViewProps & { engine: SessionEngine; tokensConfigured: boolean; onDismiss?: () => void }) {
  const onClosed = useCallback(() => onOpenChange(false), [onOpenChange]);
  useClosedEngine(engine, onClosed);
  const dialog = useRef<HTMLDivElement>(null), previousFocus = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, [engine]);
  const combobox = useCommandCombobox(engine, { root: dialog, tokensConfigured, tokenFeedback, onDismiss });
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
  return <div role="dialog" aria-modal="true" aria-label={label} id={id} ref={dialog} onKeyDown={keyDown}>
    <CommandSessionView combobox={combobox} renderProgress={renderProgress} renderTag={renderTag} />
  </div>;
}
