// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommandPalette, type Command } from './index';

afterEach(cleanup);

it('waits for execution before displaying the after screen with its result', async () => {
  let resolve!: (value: string) => void;
  const run = vi.fn(() => new Promise<string>(done => { resolve = done; }));
  const onOpenChange = vi.fn();
  const commands: Command[] = [{ id: 'deploy', label: 'Deploy', run, finalStep: {
    timing: 'after', closeOnComplete: false,
    render: context => <p>Result: {String(context.result)}</p>,
  } }];
  const user = userEvent.setup();
  render(<CommandPalette open commands={commands} onOpenChange={onOpenChange} />);
  await user.click(screen.getByRole('option', { name: 'Deploy' }));
  expect(run).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('status').textContent).toContain('Running');
  expect(screen.queryByText(/Result:/)).toBeNull();
  expect(onOpenChange).not.toHaveBeenCalled();
  await act(async () => { resolve('success'); });
  expect(screen.getByText('Result: success')).toBeTruthy();
  expect(onOpenChange).not.toHaveBeenCalled();
});

it('closes after success when closeOnComplete is true', async () => {
  const run = vi.fn(async () => 'success'), onOpenChange = vi.fn();
  const user = userEvent.setup();
  render(<CommandPalette open onOpenChange={onOpenChange} commands={[{
    id: 'deploy', label: 'Deploy', run, finalStep: { timing: 'after', closeOnComplete: true },
  }]} />);
  await user.click(screen.getByRole('option', { name: 'Deploy' }));
  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  expect(run).toHaveBeenCalledTimes(1);
});

it('does not render a skipped final step on execution failure and permits retry', async () => {
  const run = vi.fn().mockRejectedValueOnce(new Error('Temporary error')).mockResolvedValueOnce('success');
  const onOpenChange = vi.fn();
  const user = userEvent.setup();
  render(<CommandPalette open onOpenChange={onOpenChange} commands={[{
    id: 'deploy', label: 'Deploy', run,
    finalStep: { timing: 'before', when: () => false, render: () => <p>Unexpected final screen</p> },
  }]} />);
  await user.click(screen.getByRole('option', { name: 'Deploy' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Temporary error');
  expect(screen.queryByText('Unexpected final screen')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  expect(run).toHaveBeenCalledTimes(2);
});
