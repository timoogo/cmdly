// @vitest-environment jsdom
import React, { StrictMode, createRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommandBubble, createCommandEngine, type Command, type CommandBubbleHandle, type CommandBubbleProps } from '@cmdly/react';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const commands: Command[] = [{ id: 'hello', label: 'Say hello', run: vi.fn() }, { id: 'bye', label: 'Say bye', run: vi.fn() }];
const trigger = () => screen.getByRole('button', { name: 'Command palette' });
const dialog = () => screen.queryByRole('dialog');

describe('CommandBubble (trigger mode)', () => {
  it('opens and closes the palette from the trigger with consistent ARIA', async () => {
    const user = userEvent.setup();
    render(<CommandBubble commands={commands} />);
    const button = trigger();
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-controls')).toBeNull();
    expect(dialog()).toBeNull();
    await user.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.getAttribute('aria-controls')).toBe(screen.getByRole('dialog', { name: 'Command palette' }).id);
    expect(document.activeElement).toBe(screen.getByRole('combobox'));
    await user.click(button); // re-activation closes
    expect(dialog()).toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(button);
  });

  it('works from the keyboard and restores focus to the trigger after Escape', async () => {
    const user = userEvent.setup();
    render(<><button>Before</button><CommandBubble commands={commands} /></>);
    await user.tab(); await user.tab();
    expect(document.activeElement).toBe(trigger());
    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(screen.getByRole('combobox'));
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('option', { name: 'Say bye' }).getAttribute('aria-selected')).toBe('true');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(dialog()).toBeNull());
    expect(document.activeElement).toBe(trigger());
    await user.keyboard(' ');
    expect(dialog()).not.toBeNull();
  });

  it('closes after a successful command and reports it', async () => {
    const user = userEvent.setup(), onOpenChange = vi.fn(), run = vi.fn();
    render(<CommandBubble commands={[{ id: 'go', label: 'Go', run }]} onOpenChange={onOpenChange} />);
    await user.click(trigger());
    await user.keyboard('{Enter}');
    await waitFor(() => expect(dialog()).toBeNull());
    expect(run).toHaveBeenCalledOnce();
    expect(onOpenChange.mock.calls).toEqual([[true], [false]]);
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger());
  });

  it('supports defaultOpen', () => {
    render(<CommandBubble commands={commands} defaultOpen />);
    expect(dialog()).not.toBeNull();
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
  });

  it('follows the controlled state and only requests changes', async () => {
    const user = userEvent.setup(), onOpenChange = vi.fn();
    const view = render(<CommandBubble commands={commands} open={false} onOpenChange={onOpenChange} />);
    await user.click(trigger());
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(dialog()).toBeNull(); // the owner did not accept the change
    view.rerender(<CommandBubble commands={commands} open onOpenChange={onOpenChange} />);
    expect(dialog()).not.toBeNull();

    function Owner() {
      const [open, setOpen] = useState(false);
      return <><button onClick={() => setOpen(true)}>External</button><CommandBubble commands={commands} open={open} onOpenChange={setOpen} /></>;
    }
    view.unmount();
    render(<Owner />);
    await user.click(screen.getByRole('button', { name: 'External' }));
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(dialog()).toBeNull());
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });

  it('exposes open, close and toggle through a ref', () => {
    const ref = createRef<CommandBubbleHandle>(), onOpenChange = vi.fn();
    render(<CommandBubble ref={ref} commands={commands} onOpenChange={onOpenChange} />);
    act(() => ref.current!.open());
    act(() => ref.current!.open()); // no-op when already open
    expect(dialog()).not.toBeNull();
    act(() => ref.current!.toggle());
    expect(dialog()).toBeNull();
    act(() => ref.current!.toggle());
    act(() => ref.current!.close());
    expect(dialog()).toBeNull();
    expect(onOpenChange.mock.calls).toEqual([[true], [false], [true], [false]]);
  });

  it('renders a custom trigger and label', () => {
    render(<CommandBubble commands={commands} label="Actions" trigger={<svg data-testid="icon" aria-hidden="true" />} />);
    const button = screen.getByRole('button', { name: 'Actions' });
    expect(button.querySelector('[data-testid="icon"]')).not.toBeNull();
    act(() => button.click());
    expect(screen.getByRole('dialog', { name: 'Actions' })).toBeTruthy();
  });

  it('positions a floating bubble and leaves an inline one in the flow', () => {
    const view = render(<CommandBubble commands={commands} className="mine" style={{ zIndex: 5 }} />);
    let wrapper = document.querySelector<HTMLElement>('[data-cmdly-bubble]')!;
    expect(wrapper.dataset).toMatchObject({ mode: 'trigger', layout: 'floating', placement: 'bottom-right', state: 'closed' });
    expect(wrapper.className).toBe('mine');
    expect(wrapper.style).toMatchObject({ position: 'fixed', bottom: '16px', right: '16px', zIndex: '5' });
    view.rerender(<CommandBubble commands={commands} placement="top-left" offset={8} />);
    wrapper = document.querySelector<HTMLElement>('[data-cmdly-bubble]')!;
    expect(wrapper.style).toMatchObject({ position: 'fixed', top: '8px', left: '8px', bottom: '', right: '' });
    view.rerender(<CommandBubble commands={commands} layout="inline" placement="top-left" />);
    wrapper = document.querySelector<HTMLElement>('[data-cmdly-bubble]')!;
    expect(wrapper.style.position).toBe('');
    expect(wrapper.dataset.placement).toBeUndefined();
    expect(wrapper.contains(trigger())).toBe(true);
    act(() => trigger().click());
    expect(wrapper.contains(screen.getByRole('dialog'))).toBe(false); // the palette is not nested in the bubble
  });

  it('starts an independent session at each opening by default', async () => {
    const user = userEvent.setup();
    render(<CommandBubble commands={commands} />);
    await user.click(trigger());
    await user.type(screen.getByRole('combobox'), 'bye');
    await user.click(trigger());
    await user.click(trigger());
    expect((screen.getByRole('combobox') as HTMLInputElement).value).toBe('');
  });

  it('shows an external engine without closing or destroying it', async () => {
    const user = userEvent.setup(), onClose = vi.fn();
    const engine = createCommandEngine({ commands, callbacks: { onClose } });
    const view = render(<CommandBubble engine={engine} />);
    await user.click(trigger());
    await user.type(screen.getByRole('combobox'), 'bye');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(dialog()).toBeNull());
    await user.click(trigger());
    expect((screen.getByRole('combobox') as HTMLInputElement).value).toBe('bye');
    await user.click(trigger());
    view.unmount();
    await act(async () => { await Promise.resolve(); });
    expect(engine.getSnapshot().closed).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
    let notified = 0;
    const off = engine.subscribe(() => { notified++; });
    engine.setQuery('alive');
    off();
    expect(notified).toBe(1); // a destroyed engine no longer notifies
    engine.destroy();
  });

  it('warns once per extra bubble, not for a StrictMode replay', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const single = render(<StrictMode><CommandBubble commands={commands} /></StrictMode>);
    expect(warn).not.toHaveBeenCalled();
    single.unmount();
    render(<><CommandBubble commands={commands} label="One" /><CommandBubble commands={commands} label="Two" /></>);
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0][0])).toContain('single CommandBubble');
  });

  it('rejects ambiguous configurations at compile time', () => {
    const engine = createCommandEngine({ commands });
    const ok: CommandBubbleProps[] = [{ commands }, { engine, layout: 'inline' }, { commands, tokens: { types: [] }, tokenFeedback: 'loader', placement: 'top-left' }];
    expect(ok).toHaveLength(3);
    if (false as boolean) {
      // @ts-expect-error engine and commands are mutually exclusive
      void (<CommandBubble engine={engine} commands={commands} />);
      // @ts-expect-error session options belong to the external engine
      void (<CommandBubble engine={engine} plugins={[]} />);
      // @ts-expect-error only the trigger mode exists for now
      void (<CommandBubble commands={commands} mode="standalone" />);
    }
  });
});
