// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommandPalette, type Command, type TokenRunContext } from '@cmdly/react';

afterEach(cleanup);

function App({ commands }: { commands: Command[] }) {
  const [open, setOpen] = useState(false);
  return <><button onClick={() => setOpen(true)}>Open</button><CommandPalette commands={commands} tokens={{ types: [{ id: 'user', prefix: '@' }] }} open={open} onOpenChange={setOpen} /></>;
}

const hangingRun = () => {
  const contexts: Partial<TokenRunContext>[] = [];
  const run = vi.fn((_answers: unknown, context?: Partial<TokenRunContext>) => { contexts.push(context ?? {}); return new Promise(() => {}); });
  return { run, contexts };
};

describe('CommandPalette while a command runs', () => {
  it('keeps focus in a read-only input, blocks edits and re-selection, and closes with Escape', async () => {
    const user = userEvent.setup(), { run, contexts } = hangingRun();
    render(<App commands={[{ id: 'slow', label: 'Slow', run }, { id: 'other', label: 'Other', run: vi.fn() }]} />);
    const opener = screen.getByRole('button', { name: 'Open' });
    await user.click(opener);
    await user.keyboard('{Enter}');
    expect(screen.getByText('Running command…')).toBeTruthy();
    const input = screen.getByRole('combobox') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    expect(input.readOnly).toBe(true);
    expect(input.disabled).toBe(false);
    expect(input.getAttribute('aria-disabled')).toBe('true');
    await user.keyboard('abc{Enter}{Enter}');
    expect(input.value).toBe('');
    expect(run).toHaveBeenCalledTimes(1);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(opener);
    expect(contexts[0].signal?.aborted).toBe(true);
  });

  it('keeps Cancel and the aria-disabled Back button usable without leaving the dialog on the final step', async () => {
    const user = userEvent.setup(), { run, contexts } = hangingRun();
    render(<App commands={[{ id: 'c', label: 'Confirm me', finalStep: { timing: 'before' }, steps: [{ id: 's', label: 'S', options: [{ value: 'x', label: 'X' }] }], run }]} />);
    const opener = screen.getByRole('button', { name: 'Open' });
    await user.click(opener);
    await user.keyboard('{Enter}{Enter}');
    const confirm = screen.getByRole('button', { name: 'Confirm' });
    await user.click(confirm);
    expect(run).toHaveBeenCalledTimes(1);
    expect(confirm.hasAttribute('disabled')).toBe(false);
    expect(confirm.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    await user.click(confirm);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeTruthy(); // Back is ignored while running
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(opener);
    expect(contexts[0].signal?.aborted).toBe(true);
  });

  it('closes with the Cancel button while running', async () => {
    const user = userEvent.setup(), { run, contexts } = hangingRun();
    render(<App commands={[{ id: 'slow', label: 'Slow', run }]} />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.keyboard('{Enter}');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(contexts[0].signal?.aborted).toBe(true);
  });
});
