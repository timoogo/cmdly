import { useEffect, useLayoutEffect, useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import type { CommandView, ResolvedTagDefinition, WorkflowProgress } from '@cmdly/core';
import { SessionHost, type ExternalEngineProps, type HostedSession, type OwnedEngineProps } from './session-host.js';
import { useCommandCombobox } from './combobox.js';
import { SessionContent } from './session-view.js';
import type { CommandCombobox } from './combobox.js';
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
  /**
   * Custom content replacing the default view. It receives the session's headless state, props and actions
   * (`useCommandCombobox`); keyboard handling, focus, token announcements and closing stay with the container.
   * `renderProgress` and `renderTag` only apply to the default view.
   */
  children?: (command: CommandCombobox) => ReactNode;
};

export type CommandPaletteProps = PaletteViewProps & (OwnedEngineProps | ExternalEngineProps);

export type { ExternalEngineProps, OwnedEngineProps };

const tabbable = 'input:not([disabled]), button:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

export function CommandPalette(props: CommandPaletteProps) {
  if (!props.open) return null;
  const { tokenFeedback, open: _open, onOpenChange, label, id, renderProgress, renderTag, children, ...engine } = props;
  return <SessionHost {...engine as OwnedEngineProps | ExternalEngineProps} onOpenChange={onOpenChange}>
    {session => <PaletteSurface {...session} tokenFeedback={tokenFeedback} label={label} id={id} renderProgress={renderProgress} renderTag={renderTag}>{children}</PaletteSurface>}
  </SessionHost>;
}

/** Modal container: initial focus, Tab containment and focus restoration around one session view. */
function PaletteSurface({ engine, onDismiss, tokenFeedback, label = 'Command palette', id, renderProgress, renderTag, children }: Omit<PaletteViewProps, 'open' | 'onOpenChange'> & HostedSession) {
  const previousFocus = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, [engine]);
  const combobox = useCommandCombobox(engine, { tokenFeedback, onDismiss });
  const input = combobox.inputProps.ref;
  useEffect(() => {
    input.current?.focus();
    return () => { previousFocus.current?.focus(); };
  }, [engine]);
  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Tab') { combobox.rootProps.onKeyDown(event); return; }
    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(tabbable));
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  return <div role="dialog" aria-modal="true" aria-label={label} id={id} ref={combobox.rootProps.ref} onKeyDown={keyDown}>
    <SessionContent combobox={combobox} renderProgress={renderProgress} renderTag={renderTag}>{children}</SessionContent>
  </div>;
}
