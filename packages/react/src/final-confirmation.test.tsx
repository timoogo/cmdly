// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommandBubble, CommandPalette, createCommandEngine, type Command } from '@cmdly/react';

afterEach(cleanup);

// A confirmation (before final step) kept open with closeOnComplete: false shows a persistent result after Confirm.
const deploy = (closeOnComplete?: boolean): Command => ({
  id: 'deploy', label: 'Deploy', steps: [{ id: 'env', label: 'Environment', options: [{ value: 'prod', label: 'Production' }] }],
  finalStep: { timing: 'before', closeOnComplete }, run: vi.fn(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }),
});
const dialog = () => screen.queryByRole('dialog');
const bubble = () => screen.getByRole('button', { name: 'Command palette' });

function Palette({ commands }: { commands: Command[] }) {
  const [open, setOpen] = useState(true);
  return <CommandPalette commands={commands} open={open} onOpenChange={setOpen} />;
}
async function confirm(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard('{Enter}{Enter}'); // Deploy, Production
  await user.click(screen.getByRole('button', { name: 'Confirm' }));
}
async function expectPersistentResult(user: ReturnType<typeof userEvent.setup>, command: Command) {
  expect(await screen.findByText('Command completed.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull(); // no second run from the result
  expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
  await new Promise(resolve => setTimeout(resolve, 60));
  expect(dialog()).not.toBeNull(); // not closed automatically
  expect(command.run).toHaveBeenCalledOnce();
  await user.click(screen.getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(dialog()).toBeNull());
}

describe('a confirmation kept open after success', () => {
  it('palette: runs once, then shows a persistent result with Close', async () => {
    const user = userEvent.setup(), command = deploy(false);
    render(<Palette commands={[command]} />);
    await confirm(user);
    await expectPersistentResult(user, command);
  });

  it.each(['trigger', 'standalone'] as const)('%s bubble: same persistent result', async mode => {
    const user = userEvent.setup(), command = deploy(false);
    render(<CommandBubble mode={mode} commands={[command]} />);
    await user.click(bubble());
    await confirm(user);
    await expectPersistentResult(user, command);
  });

  it('external session: the result stays until the interface is closed', async () => {
    const user = userEvent.setup(), command = deploy(false);
    const engine = createCommandEngine({ commands: [command] });
    function Page() { const [open, setOpen] = useState(true); return <CommandPalette engine={engine} open={open} onOpenChange={setOpen} />; }
    render(<Page />);
    await confirm(user);
    await expectPersistentResult(user, command);
    expect(engine.getSnapshot()).toMatchObject({ closed: false, phase: 'final', status: 'success' });
    engine.destroy();
  });

  it('still closes automatically by default (closeOnComplete not set)', async () => {
    const user = userEvent.setup(), command = deploy();
    render(<Palette commands={[command]} />);
    await confirm(user);
    await waitFor(() => expect(dialog()).toBeNull());
    expect(command.run).toHaveBeenCalledOnce();
  });
});
