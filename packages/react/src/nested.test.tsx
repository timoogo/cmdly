// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CommandPalette, type Command } from '@cmdly/react';

afterEach(cleanup);
const key = (name: string) => fireEvent.keyDown(screen.getByRole('combobox'), { key: name });

it('navigates three levels, inherits answers, hides conditional children, and goes back', async () => {
  const run = vi.fn(), parentRun = vi.fn();
  const commands: Command[] = [{ id: 'git', label: 'Git', run: parentRun, steps: [{ id: 'mode', label: 'Mode', options: [{ value: 'simple', label: 'Simple' }, { value: 'advanced', label: 'Advanced' }] }], commands: [
    { id: 'branches', label: 'Branches', commands: [
      { id: 'create', label: 'Create', when: a => a.mode === 'advanced', steps: [{ id: 'name', label: 'Name', options: [{ value: 'feature', label: 'Feature' }] }], run },
      { id: 'list', label: 'List', run: vi.fn() }
    ] }
  ] }];
  render(<CommandPalette commands={commands} open onOpenChange={() => {}} />);
  key('Enter'); key('ArrowDown'); key('Enter'); key('Enter');
  expect(screen.getByRole('option', { name: 'Create' })).toBeTruthy();
  key('Escape'); expect(screen.getByRole('option', { name: 'Branches' })).toBeTruthy();
  key('Escape'); expect(screen.getByRole('combobox', { name: 'Mode' })).toBeTruthy();
  key('ArrowUp'); key('Enter'); key('Enter');
  expect(screen.queryByRole('option', { name: 'Create' })).toBeNull();
  key('Escape'); key('Escape'); key('ArrowDown'); key('Enter'); key('Enter'); key('Enter'); key('Enter');
  await waitFor(() => expect(run).toHaveBeenCalledWith({ mode: 'advanced', name: 'feature' }));
  expect(parentRun).not.toHaveBeenCalled();
});

it('bounds recursive cycles and supports large child menus with full keyboard selection', async () => {
  const run = vi.fn();
  const parent: Command = { id: 'parent', label: 'Parent', maxVisibleItems: 3, commands: [] };
  parent.commands!.push(parent, ...Array.from({ length: 10001 }, (_, i) => ({ id: String(i), label: `Item ${i}`, run })));
  render(<CommandPalette commands={[parent]} open onOpenChange={() => {}} />);
  key('Enter');
  expect(screen.queryByRole('option', { name: 'Parent' })).toBeNull();
  expect(screen.getAllByRole('option')).toHaveLength(3);
  key('ArrowUp');
  const input = screen.getByRole('combobox');
  expect(document.getElementById(input.getAttribute('aria-activedescendant')!)?.textContent).toBe('Item 10000');
  key('Enter');
  await waitFor(() => expect(run).toHaveBeenCalledWith({}));
});

it('preserves async errors and retry in nested workflows', async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error('Failed')).mockResolvedValueOnce([{ value: 'ok', label: 'Okay' }]);
  const run = vi.fn();
  render(<CommandPalette commands={[{ id: 'group', label: 'Group', commands: [{ id: 'child', label: 'Child', steps: [{ id: 'choice', label: 'Choice', options: load }], run }] }]} open onOpenChange={() => {}} />);
  key('Enter'); key('Enter');
  expect((await screen.findByRole('alert')).textContent).toContain('Failed');
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByRole('option', { name: 'Okay' });
  key('Enter'); await waitFor(() => expect(run).toHaveBeenCalledWith({ choice: 'ok' }));
});
