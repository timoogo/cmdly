import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useRef, useState } from 'react';
import type { CSSProperties, JSX, ReactNode, RefAttributes } from 'react';
import { CommandPalette, type CommandPaletteProps, type ExternalEngineProps, type OwnedEngineProps, type PaletteViewProps } from './palette.js';

/** Imperative actions of a `CommandBubble` ref. They go through `onOpenChange` like any other change. */
export type CommandBubbleHandle = { open: () => void; close: () => void; toggle: () => void };

export type CommandBubblePlacement = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';

type BubbleOwnProps = {
  /** `'trigger'`: the bubble opens and closes a `CommandPalette`. Only mode available for now. */
  mode?: 'trigger';
  /** `'floating'` (default) pins the bubble to a viewport corner; `'inline'` leaves it in the layout flow. */
  layout?: 'floating' | 'inline';
  /** Corner used by the floating layout. Defaults to `'bottom-right'`. */
  placement?: CommandBubblePlacement;
  /** Distance from the viewport edges in the floating layout, in pixels. Defaults to `16`. */
  offset?: number;
  /** Content of the trigger button. Defaults to the label. The button keeps its role, ARIA and keyboard behaviour. */
  trigger?: ReactNode;
  /** Accessible name of the trigger and of the palette. Defaults to `'Command palette'`. */
  label?: string;
  /** Controlled state, with `onOpenChange`. */
  open?: boolean;
  /** Initial state when uncontrolled. Defaults to `false`. */
  defaultOpen?: boolean;
  /** Called on every change: trigger, Escape, Cancel, completion, or the ref's actions. */
  onOpenChange?: (open: boolean) => void;
  /** Applied to the bubble's wrapper (not to the palette). */
  className?: string;
  style?: CSSProperties;
};

export type CommandBubbleProps = BubbleOwnProps & Omit<PaletteViewProps, 'open' | 'onOpenChange' | 'label' | 'id'> & (OwnedEngineProps | ExternalEngineProps);

declare const process: { env: { NODE_ENV?: string } };
let mountedBubbles = 0;
function warnOnSecondBubble() {
  try { if (process.env.NODE_ENV === 'production') return; } catch { /* no bundler define: development */ }
  console.warn('Cmdly: several CommandBubble components are mounted. Cmdly expects a single CommandBubble per application.');
}

/**
 * A trigger button that opens and closes a `CommandPalette`. Sessions follow the palette's rules: with
 * `commands`, one session per opening; with `engine`, a session you own that is never closed or destroyed.
 */
export const CommandBubble = forwardRef<CommandBubbleHandle, CommandBubbleProps>(function CommandBubble(props, ref): JSX.Element {
  const { mode: _mode = 'trigger', layout = 'floating', placement = 'bottom-right', offset = 16, trigger, label = 'Command palette', open, defaultOpen = false, onOpenChange, className, style, ...palette } = props;
  const [uncontrolled, setUncontrolled] = useState(defaultOpen);
  const isOpen = open ?? uncontrolled;
  const current = useRef(isOpen);
  current.current = isOpen;
  const controlled = open !== undefined;
  const setOpen = useCallback((next: boolean) => {
    if (next === current.current) return;
    current.current = next;
    if (!controlled) setUncontrolled(next);
    onOpenChange?.(next);
  }, [controlled, onOpenChange]);
  useImperativeHandle(ref, () => ({ open: () => setOpen(true), close: () => setOpen(false), toggle: () => setOpen(!current.current) }), [setOpen]);

  useEffect(() => {
    if (++mountedBubbles > 1) warnOnSecondBubble();
    return () => { mountedBubbles--; };
  }, []);

  const paletteId = useId();
  const [vertical, horizontal] = placement.split('-') as ['top' | 'bottom', 'left' | 'right'];
  const position: CSSProperties | undefined = layout === 'floating' ? { position: 'fixed', [vertical]: offset, [horizontal]: offset } : undefined;
  return <>
    <div data-cmdly-bubble="" data-mode="trigger" data-layout={layout} data-placement={layout === 'floating' ? placement : undefined} data-state={isOpen ? 'open' : 'closed'} className={className} style={{ ...position, ...style }}>
      <button type="button" aria-label={label} aria-haspopup="dialog" aria-expanded={isOpen} aria-controls={isOpen ? paletteId : undefined}
        // Focus the trigger first (Safari does not focus buttons on click) so the palette restores focus to it.
        onClick={event => { event.currentTarget.focus(); setOpen(!current.current); }}>
        {trigger ?? label}
      </button>
    </div>
    <CommandPalette {...palette as CommandPaletteProps} id={paletteId} label={label} open={isOpen} onOpenChange={setOpen} />
  </>;
  // Declared as a plain function component: a `ForwardRefExoticComponent` type is not portable across
  // @types/react 18 and 19 (supported peer range), whereas a function returning `JSX.Element` is.
}) as unknown as (props: CommandBubbleProps & RefAttributes<CommandBubbleHandle>) => JSX.Element;
