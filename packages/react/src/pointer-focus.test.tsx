// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { CommandBubble, CommandPalette, type Command } from '@cmdly/react';

afterEach(cleanup);

it('keeps the input focused after a pointer selection between steps so keyboard navigation continues', async () => {
  const user = userEvent.setup(), run = vi.fn();
  const commands: Command[] = [{ id: 'flow', label: 'Flow', steps: [
    { id: 'first', label: 'First', options: [{ value: 'a', label: 'First choice' }] },
    { id: 'second', label: 'Second', options: [{ value: 'b', label: 'Second choice' }, { value: 'c', label: 'Other choice' }] },
  ], run }];
  render(<CommandPalette commands={commands} open onOpenChange={() => {}} />);
  await user.keyboard('{Enter}');
  await user.click(screen.getByRole('option', { name: 'First choice' }));
  expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Second' }));
  await user.keyboard('{ArrowDown}{Enter}');
  expect(run).toHaveBeenCalledWith({ first: 'a', second: 'c' });
});

it.each(['palette', 'trigger', 'standalone'] as const)('%s keeps focus through nested menus and moves it to the final controls', async surface => {
  const user = userEvent.setup(), run = vi.fn();
  const commands: Command[] = [{ id: 'parent', label: 'Parent', commands: [{ id: 'child', label: 'Child', commands: [{
    id: 'flow', label: 'Flow', steps: [{ id: 'choice', label: 'Choice', options: [{ value: 'a', label: 'A' }] }],
    finalStep: { timing: 'before', closeOnComplete: false }, run,
  }] }] }];
  if (surface === 'palette') render(<CommandPalette commands={commands} open onOpenChange={() => {}} />);
  else { render(<CommandBubble mode={surface} commands={commands} />); await user.click(screen.getByRole('button', { name: 'Command palette' })); }
  await user.click(screen.getByRole('option', { name: 'Parent' }));
  expect(document.activeElement).toBe(screen.getByRole('combobox'));
  await user.click(screen.getByRole('option', { name: 'Child' }));
  expect(document.activeElement).toBe(screen.getByRole('combobox'));
  await user.keyboard('{Enter}');
  expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Choice' }));
  await user.click(screen.getByRole('option', { name: 'A' }));
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Back' }));
  await user.click(screen.getByRole('button', { name: 'Confirm' }));
  expect(await screen.findByRole('button', { name: 'Close' })).toBe(document.activeElement);
  expect(run).toHaveBeenCalledOnce();
});

it('allows a focusable element inside a custom option to receive focus', async () => {
  const user = userEvent.setup();
  render(<CommandPalette commands={[{ id: 'x', label: 'X', run: vi.fn() }]} open onOpenChange={() => {}}>
    {({ inputProps, listboxProps, getOptionProps }) => <><input {...inputProps} aria-label="Search" /><ul {...listboxProps}>
      <li {...getOptionProps(0)}><button onClick={event => event.stopPropagation()}>Details</button></li>
    </ul></>}
  </CommandPalette>);
  await user.click(screen.getByRole('button', { name: 'Details' }));
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Details' }));
});

it('does not refocus the input when an option is selected from another focused control', async () => {
  const user = userEvent.setup();
  render(<CommandPalette commands={[{ id: 'parent', label: 'Parent', commands: [{ id: 'child', label: 'Child', run: vi.fn() }] }]} open onOpenChange={() => {}} />);
  screen.getByRole('button', { name: 'Cancel' }).focus();
  await user.click(screen.getByRole('option', { name: 'Parent' }));
  expect(document.activeElement).not.toBe(screen.getByRole('combobox'));
});
