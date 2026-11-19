import { useEffect, useLayoutEffect, useRef } from 'react';
import type { CSSProperties, RefObject } from 'react';
import { useCommandCombobox } from './combobox.js';
import { CommandSessionView } from './session-view.js';
import type { HostedSession } from './session-host.js';
import type { PaletteViewProps } from './palette.js';

export type PopoverSurfaceProps = Omit<PaletteViewProps, 'open' | 'onOpenChange'> & HostedSession & {
  /** Element containing the trigger and the popover: interactions inside it are not "outside". */
  anchor: RefObject<HTMLElement | null>;
  trigger: RefObject<HTMLElement | null>;
  /** Side of the anchor the popover opens on, and the edge it is aligned with. */
  side: 'top' | 'bottom';
  align: 'left' | 'right';
};

/**
 * Internal. Non-modal container of a session view, positioned against its anchor. It closes on an outside
 * pointer press, when focus leaves the bubble, and through the session view (Escape at the root, Cancel,
 * completion). Focus returns to the trigger only when it was inside the popover (Escape, Cancel, completion);
 * an outside press or Tab leaves focus where the user moved it. Tab is never contained.
 */
export function PopoverSurface({ engine, tokensConfigured, onDismiss, tokenFeedback = 'banner', label = 'Command palette', id, renderProgress, renderTag, anchor, trigger, side, align }: PopoverSurfaceProps) {
  const popover = useRef<HTMLDivElement>(null);
  const combobox = useCommandCombobox(engine, { root: popover, tokensConfigured, tokenFeedback, onDismiss });
  const restoreFocus = useRef(true);
  const dismiss = useRef(combobox.dismiss);
  dismiss.current = combobox.dismiss;
  const leave = useRef((restore: boolean) => { restoreFocus.current = restore; dismiss.current(); }).current;

  // An outside press, or focus arriving outside the bubble (Tab from the popover or from the trigger),
  // closes the popover. Focus going nowhere (window switch, browser UI) fires no `focusin`: not a departure.
  useEffect(() => {
    const onOutside = (event: Event) => { if (anchor.current && !anchor.current.contains(event.target as Node)) leave(false); };
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('focusin', onOutside, true);
    return () => { document.removeEventListener('pointerdown', onOutside, true); document.removeEventListener('focusin', onOutside, true); };
  }, [anchor, leave]);
  // Runs before the popover leaves the DOM, while the focused element is still inside it.
  useLayoutEffect(() => () => {
    if (restoreFocus.current && popover.current?.contains(document.activeElement)) trigger.current?.focus();
  }, [trigger]);

  const position: CSSProperties = { position: 'absolute', [side === 'top' ? 'bottom' : 'top']: 'calc(100% + 8px)', [align]: 0 };
  return <div role="dialog" aria-label={label} id={id} ref={popover} data-cmdly-bubble-popover="" data-side={side} data-align={align} style={position} onKeyDown={combobox.onKeyDown}>
    <CommandSessionView combobox={combobox} renderProgress={renderProgress} renderTag={renderTag} />
  </div>;
}
