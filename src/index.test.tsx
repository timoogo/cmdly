// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommandPalette, type Command } from './index';

afterEach(cleanup);
function App({ commands }: { commands: Command[] }) {
  const [open, setOpen] = useState(false);
  return <><button onClick={() => setOpen(true)}>Open</button><CommandPalette commands={commands} open={open} onOpenChange={setOpen} /></>;
}

describe('CommandPalette', () => {
  it('searches and runs commands with the keyboard, restoring focus', async () => {
    const user = userEvent.setup(), run = vi.fn();
    render(<App commands={[{ id: 'a', label: 'Alpha', run: vi.fn() }, { id: 'b', label: 'Beta', run }]} />);
    const opener = screen.getByRole('button', { name: 'Open' });
    await user.click(opener);
    const input = screen.getByRole('combobox');
    expect(document.activeElement).toBe(input);
    await user.keyboard('{ArrowDown}{Enter}');
    await waitFor(() => expect(run).toHaveBeenCalledWith({}));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(opener);
    await user.click(opener); await user.type(screen.getByRole('combobox'), 'alp');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    await user.keyboard('{Escape}'); expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('handles conditional steps, back navigation, and answer replacement', async () => {
    const user = userEvent.setup(), run = vi.fn();
    render(<App commands={[{ id: 'flow', label: 'Flow', run, steps: [
      { id: 'kind', label: 'Kind', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] },
      { id: 'extra', label: 'Extra', when: a => a.kind === 'a', options: [{ value: 'x', label: 'X' }] },
      { id: 'end', label: 'End', options: [{ value: 'z', label: 'Z' }] }
    ] }]} />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.keyboard('{Enter}{Enter}{Enter}');
    expect(screen.getByRole('combobox', { name: 'End' })).toBeTruthy();
    await user.keyboard('{Escape}{Escape}');
    expect(screen.getByRole('combobox', { name: 'Kind' })).toBeTruthy();
    await user.keyboard('{ArrowDown}{Enter}{Enter}');
    await waitFor(() => expect(run).toHaveBeenCalledWith({ kind: 'b', end: 'z' }));
  });
  it('shows async failures and retries option loading', async () => {
    const user = userEvent.setup(), run = vi.fn();
    const options = vi.fn().mockRejectedValueOnce(new Error('Network error')).mockResolvedValueOnce([{ value: 'ok', label: 'Okay' }]);
    render(<App commands={[{ id: 'async', label: 'Async', run, steps: [{ id: 'choice', label: 'Choice', options }] }]} />);
    await user.click(screen.getByRole('button', { name: 'Open' })); await user.keyboard('{Enter}');
    expect((await screen.findByRole('alert')).textContent).toContain('Network error');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByRole('option', { name: 'Okay' });
    await user.click(screen.getByRole('option', { name: 'Okay' }));
    await waitFor(() => expect(run).toHaveBeenCalledWith({ choice: 'ok' }));
  });
});
