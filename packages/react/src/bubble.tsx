import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useRef, useState } from 'react';
import type { CSSProperties, JSX, KeyboardEvent, MouseEvent, ReactNode, RefAttributes } from 'react';
import { CommandPalette, type CommandPaletteProps, type ExternalEngineProps, type OwnedEngineProps, type PaletteViewProps } from './palette.js';
import { SessionHost } from './session-host.js';
import { PopoverSurface } from './popover.js';

/** Imperative actions of a `CommandBubble` ref. They go through `onOpenChange` like any other change. */
export type CommandBubbleHandle = { open: () => void; close: () => void; toggle: () => void };

export type CommandBubblePlacement = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';

/** Props to spread on a custom trigger element. `ref` must reach a focusable DOM element. */
export type CommandBubbleTriggerProps = {
  ref: (node: HTMLElement | null) => void;
  type: 'button';
  'aria-label': string;
  'aria-haspopup': 'dialog';
  'aria-expanded': boolean;
  'aria-controls': string | undefined;
  'data-state': 'open' | 'closed';
  onClick: (event: MouseEvent<HTMLElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
};

type BubbleOwnProps = {
  /**
   * `'trigger'` (default): the bubble opens and closes a modal `CommandPalette`.
   * `'standalone'`: the bubble opens its own non-modal popover next to the trigger; no palette is mounted.
   * The popover closes on an outside press, when focus leaves the bubble, on Escape at the root and after
   * a successful run (unless the command keeps its final step open).
   */
  mode?: 'trigger' | 'standalone';
  /** `'floating'` (default) pins the bubble to a viewport corner; `'inline'` leaves it in the layout flow. */
  layout?: 'floating' | 'inline';
  /** Corner used by the floating layout. Defaults to `'bottom-right'`. */
  placement?: CommandBubblePlacement;
  /** Distance from the viewport edges in the floating layout, in pixels. Defaults to `16`. */
  offset?: number;
  /**
   * Content of the trigger button (defaults to the label); the button keeps its role, ARIA and keyboard behaviour.
   * A function replaces the button itself: spread the given props on your element, e.g.
   * `trigger={props => <MyButton {...props} />}` (a native `<button>` or a component forwarding them to one).
   */
  trigger?: ReactNode | ((props: CommandBubbleTriggerProps) => ReactNode);
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
 * A trigger button that opens a `CommandPalette` (`mode="trigger"`) or its own popover (`mode="standalone"`).
 * Sessions follow the palette's rules: with `commands`, one session per opening; with `engine`, a session you
 * own that is never closed or destroyed. `trigger` customizes the button, `children` the content.
 */
export const CommandBubble = forwardRef<CommandBubbleHandle, CommandBubbleProps>(function CommandBubble(props, ref): JSX.Element {
  const { mode = 'trigger', layout = 'floating', placement = 'bottom-right', offset = 16, trigger, label = 'Command palette', open, defaultOpen = false, onOpenChange, className, style, ...palette } = props;
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

  const surfaceId = useId();
  const wrapper = useRef<HTMLDivElement>(null), button = useRef<HTMLElement | null>(null);
  const setButton = useRef((node: HTMLElement | null) => { button.current = node; }).current;
  const standalone = mode === 'standalone';
  const [vertical, horizontal] = placement.split('-') as ['top' | 'bottom', 'left' | 'right'];
  // A standalone inline bubble shrinks to its trigger so the popover can be anchored to it.
  const position: CSSProperties | undefined = layout === 'floating' ? { position: 'fixed', [vertical]: offset, [horizontal]: offset } : standalone ? { position: 'relative', display: 'inline-block' } : undefined;
  const { tokenFeedback, renderProgress, renderTag, children, ...engine } = palette;
  const triggerProps: CommandBubbleTriggerProps = {
    ref: setButton, type: 'button', 'aria-label': label, 'aria-haspopup': 'dialog', 'aria-expanded': isOpen, 'aria-controls': isOpen ? surfaceId : undefined, 'data-state': isOpen ? 'open' : 'closed',
    // Focus the trigger first (Safari does not focus buttons on click) so the palette restores focus to it.
    onClick: event => { event.currentTarget.focus(); setOpen(!current.current); },
    onKeyDown: event => { if (standalone && event.key === 'Escape' && current.current) { event.preventDefault(); setOpen(false); } },
  };
  return <>
    <div ref={wrapper} data-cmdly-bubble="" data-mode={mode} data-layout={layout} data-placement={layout === 'floating' ? placement : undefined} data-state={isOpen ? 'open' : 'closed'} className={className} style={{ ...position, ...style }}>
      {typeof trigger === 'function' ? trigger(triggerProps) : <button {...triggerProps}>{trigger ?? label}</button>}
      {standalone && isOpen && <SessionHost {...engine as OwnedEngineProps | ExternalEngineProps} onOpenChange={setOpen}>
        {session => <PopoverSurface {...session} tokenFeedback={tokenFeedback} renderProgress={renderProgress} renderTag={renderTag} label={label} id={surfaceId}
          anchor={wrapper} trigger={button} side={layout === 'floating' && vertical === 'bottom' ? 'top' : 'bottom'} align={layout === 'floating' ? horizontal : 'left'}>{children}</PopoverSurface>}
      </SessionHost>}
    </div>
    {!standalone && <CommandPalette {...palette as CommandPaletteProps} id={surfaceId} label={label} open={isOpen} onOpenChange={setOpen} />}
  </>;
  // Declared as a plain function component: a `ForwardRefExoticComponent` type is not portable across
  // @types/react 18 and 19 (supported peer range), whereas a function returning `JSX.Element` is.
}) as unknown as (props: CommandBubbleProps & RefAttributes<CommandBubbleHandle>) => JSX.Element;
