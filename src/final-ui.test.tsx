// @vitest-environment jsdom
import React from 'react';
import { expect, it, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { CommandPalette, type Command } from './index';

afterEach(cleanup);
it('renders the automatic summary and executes on confirmation', async () => {
  const run = vi.fn(), close = vi.fn(), user = userEvent.setup();
  const commands: Command[] = [{ id: 'deploy', label: 'Deploy', steps: [{ id: 'env', label: 'Environment', options: [{ value: 'prod', label: 'Production' }] }], finalStep: { timing: 'before' }, run }];
  render(<CommandPalette commands={commands} open onOpenChange={close} />);
  await user.click(screen.getByRole('option', { name: 'Deploy' }));
  await user.click(screen.getByRole('option', { name: 'Production' }));
  expect(screen.getByText('Environment')).toBeTruthy();
  expect(screen.getByText('prod')).toBeTruthy();
  expect(run).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(run).toHaveBeenCalledWith({ env: 'prod' }));
  await waitFor(() => expect(close).toHaveBeenCalledWith(false));
});
it('lets a custom final renderer own its actions', async () => {
  const run = vi.fn(), close = vi.fn(), user = userEvent.setup();
  const commands: Command[] = [{ id: 'custom', label: 'Custom', run, finalStep: { timing: 'before', render: context => <button onClick={() => void context.execute()}>Ship now</button> } }];
  render(<CommandPalette commands={commands} open onOpenChange={close} />);
  await user.click(screen.getByRole('option', { name: 'Custom' }));
  expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Ship now' }));
  await waitFor(() => expect(run).toHaveBeenCalledOnce());
});
it('preserves a workflow across parent rerenders and adopts new commands', async () => {
  const user = userEvent.setup(), run = vi.fn();
  const makeCommands = (extra: boolean): Command[] => [
    { id: 'flow', label: 'Flow', run, steps: [{ id: 'a', label: 'First', options: [{ value: 'one', label: 'One' }] }, { id: 'b', label: 'Second', options: [{ value: 'two', label: 'Two' }] }] },
    ...(extra ? [{ id: 'new', label: 'New', run: () => {} }] : [])
  ];
  const view = render(<CommandPalette open commands={makeCommands(false)} onOpenChange={() => {}} />);
  await user.click(screen.getByRole('option', { name: 'Flow' }));
  await user.click(screen.getByRole('option', { name: 'One' }));
  expect(screen.getByRole('combobox', { name: 'Second' })).toBeTruthy();
  view.rerender(<CommandPalette open commands={makeCommands(true)} onOpenChange={() => {}} />);
  expect(screen.getByRole('combobox', { name: 'Second' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Back' }));
  await user.click(screen.getByRole('button', { name: 'Back' }));
  expect(screen.getByRole('option', { name: 'New' })).toBeTruthy();
});
it('updates an inline final renderer on parent rerender without looping', async () => {
  const user = userEvent.setup();
  let renders = 0;
  function Parent() {
    const [count, setCount] = React.useState(0);
    renders++;
    return <><button onClick={() => setCount(value => value + 1)}>Update</button><CommandPalette open onOpenChange={() => {}} commands={[{ id: 'flow', label: 'Flow', run: () => {}, finalStep: { timing: 'before', render: () => <p>Version {count}</p> } }]} /></>;
  }
  render(<Parent />);
  await user.click(screen.getByRole('option', { name: 'Flow' }));
  expect(screen.getByText('Version 0')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Update' }));
  expect(screen.getByText('Version 1')).toBeTruthy();
  expect(renders).toBe(2);
});
