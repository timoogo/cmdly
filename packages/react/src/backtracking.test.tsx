// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CommandPalette, type BackBehavior, type Command } from '@cmdly/react';

afterEach(cleanup);
const key = (value: string) => fireEvent.keyDown(screen.getByRole('combobox'), { key: value });
const selected = () => document.getElementById(screen.getByRole('combobox').getAttribute('aria-activedescendant')!)?.textContent;
const options = [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }];
function setup(mode: BackBehavior) {
  const run = vi.fn();
  const commands: Command[] = [{ id: 'flow', label: 'Flow', backBehavior: mode, steps: [
    { id: 'first', label: 'First', options }, { id: 'second', label: 'Second', options }, { id: 'third', label: 'Third', options }
  ], run }];
  render(<CommandPalette commands={commands} open onOpenChange={() => {}} />); key('Enter');
  return run;
}
for (const mode of ['preserve', 'reset', 'smart'] as const) {
  it(`${mode} handles backtracking and changed answers`, () => {
    const run = setup(mode);
    key('Enter'); key('ArrowDown'); key('Enter'); key('Escape'); key('Escape');
    expect(selected()).toBe('A'); key('ArrowDown'); key('Enter');
    expect(selected()).toBe(mode === 'preserve' ? 'B' : 'A');
    key('Enter'); key('Enter');
    expect(run).toHaveBeenCalledWith({ first: 'b', second: mode === 'preserve' ? 'b' : 'a', third: 'a' });
  });
}
it('inherits behavior, allows overrides, and isolates sibling answers with duplicate step IDs', () => {
  const run = vi.fn();
  const commands: Command[] = [{ id: 'root', label: 'Root', backBehavior: 'preserve', commands: [
    { id: 'one', label: 'One', steps: [{ id: 'same', label: 'Same', options }, { id: 'next', label: 'Next', options }], run },
    { id: 'two', label: 'Two', backBehavior: 'reset', steps: [{ id: 'same', label: 'Same', options }, { id: 'next', label: 'Next', options }], run }
  ] }];
  render(<CommandPalette commands={commands} open onOpenChange={() => {}} />);
  key('Enter'); key('Enter'); key('ArrowDown'); key('Enter'); key('Escape'); key('Escape');
  key('ArrowDown'); key('Enter'); expect(selected()).toBe('A'); key('ArrowDown'); key('Enter'); key('Escape'); key('Escape');
  key('Enter'); expect(selected()).toBe('B'); key('Enter'); key('Enter');
  expect(run).toHaveBeenCalledWith({ same: 'b', next: 'a' });
});
it('revalidates async selections on revisit, but retains them on load failure', async () => {
  const load = vi.fn().mockResolvedValueOnce(options).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(options).mockResolvedValueOnce([options[0]]);
  const commands: Command[] = [{ id: 'flow', label: 'Flow', steps: [{ id: 'one', label: 'One', options: load }, { id: 'two', label: 'Two', options }], run: vi.fn() }];
  render(<CommandPalette commands={commands} open onOpenChange={() => {}} />); key('Enter');
  await screen.findByRole('option', { name: 'B' }); key('ArrowDown'); key('Enter'); key('Escape');
  expect((await screen.findByRole('alert')).textContent).toContain('offline');
  fireEvent.click(screen.getByRole('button', { name: 'Retry' })); await screen.findByRole('option', { name: 'B' });
  await waitFor(() => expect(selected()).toBe('B')); key('Enter'); key('Escape');
  await waitFor(() => expect(selected()).toBe('A'));
});

it('clears a reset child on exit while preserving an inherited sibling', () => {
  const commands: Command[] = [{ id: 'root', label: 'Root', backBehavior: 'preserve', commands: [
    { id: 'keep', label: 'Keep', steps: [{ id: 'x', label: 'X', options }, { id: 'y', label: 'Y', options }], run: vi.fn() },
    { id: 'discard', label: 'Discard', backBehavior: 'reset', steps: [{ id: 'x', label: 'X', options }, { id: 'y', label: 'Y', options }], run: vi.fn() }
  ] }];
  render(<CommandPalette commands={commands} open onOpenChange={() => {}} />);
  key('Enter'); key('Enter'); key('ArrowDown'); key('Enter'); key('Escape'); key('Escape');
  key('ArrowDown'); key('Enter'); key('ArrowDown'); key('Enter'); key('Escape'); key('Escape');
  key('ArrowDown'); key('Enter'); expect(selected()).toBe('A'); key('Escape');
  key('Enter'); expect(selected()).toBe('B');
});

it('drops conditional saved answers after a smart parent change and keeps sibling answers out of execution', () => {
  const run = vi.fn();
  const commands: Command[] = [{ id: 'root', label: 'Root', steps: [{ id: 'mode', label: 'Mode', options }], commands: [
    { id: 'one', label: 'One', steps: [{ id: 'extra', label: 'Extra', options }, { id: 'end', label: 'End', options }], run },
    { id: 'two', label: 'Two', when: answers => answers.mode === 'b', steps: [{ id: 'other', label: 'Other', options }], run }
  ] }];
  render(<CommandPalette commands={commands} open onOpenChange={() => {}} />);
  key('Enter'); key('Enter'); key('Enter'); key('ArrowDown'); key('Enter'); key('Escape'); key('Escape'); key('Escape');
  key('ArrowDown'); key('Enter'); key('Enter'); expect(selected()).toBe('A'); key('Escape');
  key('ArrowDown'); key('Enter'); key('Enter');
  expect(run).toHaveBeenCalledWith({ mode: 'b', other: 'a' });
});
