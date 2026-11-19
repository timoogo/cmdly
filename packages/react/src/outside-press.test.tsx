// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommandBubble, CommandPalette, createCommandEngine, type Command, type TokenRunContext } from '@cmdly/react';

afterEach(cleanup);

const commands: Command[] = [{ id: 'hello', label: 'Say hello', run: vi.fn() }];
const bubble = () => screen.getByRole('button', { name: 'Command palette' });
const dialog = () => screen.queryByRole('dialog');
const hanging = () => {
  const signals: (AbortSignal | undefined)[] = [];
  let finish!: () => void;
  const run = vi.fn((_answers: unknown, context?: Partial<TokenRunContext>) => { signals.push(context?.signal); return new Promise<void>(done => { finish = done; }); });
  return { run, signals, finish: () => finish() };
};

describe('outside press on the palette', () => {
  it('closes the trigger bubble palette, keeps the bubble, and only presses inside are ignored', async () => {
    const user = userEvent.setup(), onOpenChange = vi.fn();
    render(<><p>Background</p><CommandBubble commands={commands} onOpenChange={onOpenChange} /></>);
    await user.click(bubble());
    await user.click(screen.getByRole('combobox')); // inside: stays open
    await user.click(screen.getByRole('option', { name: 'Say hello' }).parentElement!.parentElement!);
    expect(dialog()).not.toBeNull();
    await user.click(screen.getByText('Background'));
    expect(dialog()).toBeNull();
    expect(onOpenChange.mock.calls).toEqual([[true], [false]]);
    expect(bubble().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(bubble()); // nothing focusable pressed: focus returns to the opener
    await user.click(bubble());
    expect(dialog()).not.toBeNull(); // reopens normally
    await user.click(bubble()); // the opener toggles: closed, not reopened by the outside press
    expect(dialog()).toBeNull();
  });

  it('leaves focus on a focusable element pressed outside', async () => {
    const user = userEvent.setup();
    render(<><button>Elsewhere</button><CommandBubble commands={commands} /></>);
    await user.click(bubble());
    await user.click(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Elsewhere' }));
  });

  it('closes an owned session and aborts its run, like Escape', async () => {
    const user = userEvent.setup(), onClose = vi.fn(), { run, signals } = hanging();
    function Page() {
      const [open, setOpen] = useState(false);
      return <><button onClick={() => setOpen(true)}>Open</button><p>Background</p>
        <CommandPalette commands={[{ id: 'slow', label: 'Slow', run }]} tokens={{ types: [] }} callbacks={{ onClose }} open={open} onOpenChange={setOpen} /></>;
    }
    render(<Page />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.keyboard('{Enter}');
    expect(screen.getByText('Running command…')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Open' })); // the opener: ignored, still open
    expect(dialog()).not.toBeNull();
    await user.click(screen.getByText('Background'));
    await waitFor(() => expect(dialog()).toBeNull());
    expect(signals[0]?.aborted).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open' }));
  });

  it('only hides an external session; its run continues and it resumes', async () => {
    const user = userEvent.setup(), { run, signals, finish } = hanging();
    const engine = createCommandEngine({ commands: [{ id: 'slow', label: 'Slow', finalStep: { timing: 'after', closeOnComplete: false }, run }], tokens: { types: [] } });
    render(<><p>Background</p><CommandBubble engine={engine} /></>);
    await user.click(bubble());
    await user.keyboard('{Enter}');
    await user.click(screen.getByText('Background'));
    expect(dialog()).toBeNull();
    expect(signals[0]?.aborted).toBe(false);
    expect(engine.getSnapshot()).toMatchObject({ closed: false, running: true });
    await act(async () => { finish(); });
    await user.click(bubble());
    expect(engine.getSnapshot().status).toBe('success');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy(); // resumed on its final step
    engine.destroy();
  });

  it('keeps the standalone popover behaviour unchanged', async () => {
    const user = userEvent.setup();
    render(<><p>Background</p><CommandBubble mode="standalone" commands={commands} /></>);
    await user.click(bubble());
    await user.click(screen.getByText('Background'));
    expect(dialog()).toBeNull();
    expect(document.activeElement).not.toBe(bubble()); // a non-modal popover does not take focus back
  });
});
