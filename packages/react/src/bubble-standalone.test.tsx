// @vitest-environment jsdom
import React, { createRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommandBubble, createCommandEngine, type Command, type CommandBubbleHandle, type TokenRunContext } from '@cmdly/react';

afterEach(cleanup);

const trigger = () => screen.getByRole('button', { name: 'Command palette' });
const popover = () => screen.queryByRole('dialog');
const steps: Command = { id: 'deploy', label: 'Deploy', steps: [{ id: 'env', label: 'Environment', options: [{ value: 'prod', label: 'Production' }] }], run: vi.fn() };
const commands: Command[] = [steps, { id: 'hello', label: 'Say hello', run: vi.fn() }];
const hanging = () => {
  const contexts: Partial<TokenRunContext>[] = [];
  let finish!: () => void;
  const run = vi.fn((_answers: unknown, context?: Partial<TokenRunContext>) => { contexts.push(context ?? {}); return new Promise<void>(done => { finish = done; }); });
  return { run, contexts, finish: () => finish() };
};

function Page(props: Partial<React.ComponentProps<typeof CommandBubble>>) {
  return <><button>Before</button><CommandBubble mode="standalone" commands={commands} {...props as object} /><button>After</button></>;
}

describe('CommandBubble (standalone mode)', () => {
  it('opens a non-modal popover instead of the palette, with consistent ARIA and focus', async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(trigger());
    const dialog = screen.getByRole('dialog', { name: 'Command palette' });
    expect(dialog.hasAttribute('data-cmdly-bubble-popover')).toBe(true);
    expect(dialog.getAttribute('aria-modal')).toBeNull();
    expect(document.querySelector('[aria-modal="true"]')).toBeNull(); // no CommandPalette mounted
    expect(trigger().getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(trigger().getAttribute('aria-controls')).toBe(dialog.id);
    expect(document.querySelector('[data-cmdly-bubble]')!.contains(dialog)).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole('combobox'));
    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['Deploy', 'Say hello']);
    await user.click(trigger()); // re-activation closes, without an outside-press conflict
    expect(popover()).toBeNull();
    expect(document.activeElement).toBe(trigger());
    await user.click(trigger());
    expect(popover()).not.toBeNull();
  });

  it('closes on an outside press without moving focus to the trigger', async () => {
    const user = userEvent.setup(), onOpenChange = vi.fn();
    render(<Page onOpenChange={onOpenChange} />);
    await user.click(trigger());
    await user.click(screen.getByRole('button', { name: 'After' }));
    expect(popover()).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'After' }));
    expect(onOpenChange.mock.calls).toEqual([[true], [false]]);
  });

  it('does not trap Tab and closes when focus leaves the bubble', async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(trigger());
    await user.tab({ shift: true }); // back to the trigger: still the bubble
    expect(document.activeElement).toBe(trigger());
    expect(popover()).not.toBeNull();
    await user.tab(); // input
    await user.tab(); // Cancel
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
    expect(popover()).not.toBeNull();
    await user.tab(); // leaves the popover
    expect(popover()).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'After' }));
  });

  it('closes when focus leaves the bubble from the trigger', async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(trigger());
    await user.tab({ shift: true }); // trigger: still inside the bubble
    expect(popover()).not.toBeNull();
    await user.tab({ shift: true }); // out of the bubble
    expect(popover()).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Before' }));
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps multi-step workflows open, goes back with Escape, then closes and restores focus', async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(trigger());
    await user.keyboard('{Enter}');
    expect(screen.getByRole('combobox', { name: 'Environment' })).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('combobox', { name: 'Search commands' })).toBeTruthy();
    expect(popover()).not.toBeNull();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(popover()).toBeNull());
    expect(document.activeElement).toBe(trigger());
    await user.keyboard('{Enter}'); // the focused trigger reopens
    expect(popover()).not.toBeNull();
    await user.tab({ shift: true });
    await user.keyboard('{Escape}'); // Escape on the trigger closes too
    expect(popover()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('closes after a successful run and keeps the final step open when the command asks for it', async () => {
    const user = userEvent.setup(), run = vi.fn();
    const view = render(<Page commands={[{ id: 'go', label: 'Go', run }]} />);
    await user.click(trigger());
    await user.keyboard('{Enter}');
    await waitFor(() => expect(popover()).toBeNull());
    expect(run).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(trigger());
    view.unmount();

    render(<Page commands={[{ id: 'keep', label: 'Keep', finalStep: { timing: 'after', closeOnComplete: false, render: context => <p role="status">Done: {context.status}</p> }, run: () => 'ok' }]} />);
    await user.click(trigger());
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Done: success'));
    expect(popover()).not.toBeNull();
  });

  it('aborts the run of an owned session when it closes', async () => {
    const user = userEvent.setup(), { run, contexts } = hanging();
    render(<Page commands={[{ id: 'slow', label: 'Slow', run }]} tokens={{ types: [] }} />);
    await user.click(trigger());
    await user.keyboard('{Enter}');
    expect(screen.getByText('Running command…')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('combobox')); // read-only, focus kept
    await user.click(screen.getByRole('button', { name: 'After' }));
    await waitFor(() => expect(popover()).toBeNull());
    expect(contexts[0].signal?.aborted).toBe(true);
  });

  it('keeps the run of an external session going when the popover is dismissed', async () => {
    const user = userEvent.setup(), { run, contexts, finish } = hanging();
    const engine = createCommandEngine({ commands: [{ id: 'slow', label: 'Slow', finalStep: { timing: 'after', closeOnComplete: false }, run }], tokens: { types: [] } });
    render(<Page engine={engine} commands={undefined} />);
    await user.click(trigger());
    await user.keyboard('{Enter}');
    await user.click(screen.getByRole('button', { name: 'After' }));
    expect(popover()).toBeNull();
    expect(contexts[0].signal?.aborted).toBe(false);
    expect(engine.getSnapshot()).toMatchObject({ closed: false, running: true });
    await act(async () => { finish(); });
    await user.click(trigger());
    expect(engine.getSnapshot().status).toBe('success');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy(); // resumed on its final step
    engine.destroy();
  });

  it('shows and announces token feedback inside the popover', async () => {
    const user = userEvent.setup();
    render(<Page tokens={{ types: [{ id: 'user', prefix: '@', values: [{ value: 'bob' }] }] }} />);
    await user.click(trigger());
    const announcer = document.querySelector('[data-cmdly-token-announcer]');
    expect(popover()!.contains(announcer)).toBe(true);
    await user.type(screen.getByRole('combobox'), '@zed');
    const banner = document.querySelector('[data-cmdly-token-feedback="banner"]')!;
    expect(popover()!.contains(banner)).toBe(true);
    expect(screen.getByRole('combobox').getAttribute('aria-describedby')).toBe(banner.id);
    expect(announcer?.textContent).toBe('"@zed" is not valid');
  });

  it('supports controlled state and the ref actions', async () => {
    const user = userEvent.setup(), ref = createRef<CommandBubbleHandle>();
    function Owner() {
      const [open, setOpen] = useState(false);
      // `ref` goes to the bubble itself: function components only receive it as a prop from React 19.
      return <><button>Before</button><span data-testid="state">{String(open)}</span><CommandBubble mode="standalone" commands={commands} ref={ref} open={open} onOpenChange={setOpen} /></>;
    }
    render(<Owner />);
    act(() => ref.current!.open());
    expect(screen.getByTestId('state').textContent).toBe('true');
    expect(popover()).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Before' }));
    expect(screen.getByTestId('state').textContent).toBe('false');
    act(() => ref.current!.toggle());
    expect(popover()).not.toBeNull();
    act(() => ref.current!.close());
    expect(popover()).toBeNull();
  });

  it('anchors the popover according to the layout', async () => {
    const user = userEvent.setup();
    const view = render(<Page />);
    await user.click(trigger());
    expect(popover()!.dataset).toMatchObject({ side: 'top', align: 'right' });
    expect(popover()!.style).toMatchObject({ position: 'absolute', bottom: 'calc(100% + 8px)', right: '0px' });
    view.rerender(<Page placement="top-left" />);
    expect(popover()!.dataset).toMatchObject({ side: 'bottom', align: 'left' });
    view.rerender(<Page layout="inline" />);
    expect(popover()!.dataset).toMatchObject({ side: 'bottom', align: 'left' });
    expect(document.querySelector<HTMLElement>('[data-cmdly-bubble]')!.style).toMatchObject({ position: 'relative', display: 'inline-block' });
  });
});
