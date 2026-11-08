// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CommandPalette, type Command, type WorkflowProgress } from '@cmdly/react';

afterEach(cleanup);
const key = (key: string) => fireEvent.keyDown(screen.getByRole('combobox'), { key });
const options = [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }];
const step = (id: string) => ({ id, label: id, options });
function setup(command: Command) {
  const progress: WorkflowProgress[] = [];
  const onOpenChange = vi.fn();
  render(<CommandPalette commands={[command]} open onOpenChange={onOpenChange} renderProgress={value => { progress.push(value); return <output>{JSON.stringify(value)}</output>; }} />);
  return { progress, onOpenChange };
}
for (const mode of ['preserve', 'smart', 'reset'] as const) {
  it(`navigates previously visited steps in ${mode} mode without running`, () => {
    const run = vi.fn();
    setup({ id: 'flow', label: 'Flow', arrowNavigation: true, backBehavior: mode, steps: [step('one'), step('two')], run });
    key('Enter'); key('ArrowRight'); expect(screen.getByRole('combobox', { name: 'one' })).toBeTruthy();
    key('Enter'); key('ArrowLeft'); expect(screen.getByRole('combobox', { name: 'one' })).toBeTruthy();
    key('ArrowRight'); expect(screen.getByRole('combobox', { name: mode === 'reset' ? 'one' : 'two' })).toBeTruthy();
    expect(run).not.toHaveBeenCalled();
  });
}
it('does not intercept caret movement, composition, root, or disabled navigation', () => {
  const { onOpenChange } = setup({ id: 'flow', label: 'Flow', arrowNavigation: true, steps: [step('one')], run: vi.fn() });
  key('ArrowLeft'); expect(onOpenChange).not.toHaveBeenCalled(); key('Enter');
  const input = screen.getByRole('combobox');
  fireEvent.change(input, { target: { value: 'A' } });
  expect(fireEvent.keyDown(input, { key: 'ArrowLeft' })).toBe(true);
  expect(screen.getByRole('combobox', { name: 'one' })).toBeTruthy();
  fireEvent.change(input, { target: { value: '' } });
  expect(fireEvent.keyDown(input, { key: 'ArrowLeft', isComposing: true })).toBe(true);
});
it('navigates nested levels and invalidates forward history after a changed answer', () => {
  const run = vi.fn();
  setup({ id: 'root', label: 'Root', arrowNavigation: true, steps: [step('one')], commands: [{ id: 'child', label: 'Child', steps: [step('two')], run }] });
  key('Enter'); key('Enter'); key('Enter'); expect(screen.getByRole('combobox', { name: 'two' })).toBeTruthy();
  key('ArrowLeft'); key('ArrowLeft'); expect(screen.getByRole('combobox', { name: 'one' })).toBeTruthy();
  key('ArrowRight'); expect(screen.getByRole('combobox', { name: 'Root' })).toBeTruthy();
  key('ArrowRight'); expect(screen.getByRole('combobox', { name: 'two' })).toBeTruthy();
  key('ArrowLeft'); key('ArrowLeft'); key('ArrowDown'); key('Enter'); key('ArrowRight');
  expect(screen.getByRole('combobox', { name: 'Root' })).toBeTruthy(); expect(run).not.toHaveBeenCalled();
});
it('reports local determinate progress and global unresolved branch progress', () => {
  const { progress } = setup({ id: 'root', label: 'Root', progress: 'global', steps: [step('one')], commands: [{ id: 'child', label: 'Child', progress: 'local', steps: [step('two'), step('three')], run: vi.fn() }] });
  expect(progress).toHaveLength(0); key('Enter');
  expect(progress[progress.length - 1]).toMatchObject({ mode: 'global', current: 1, total: null, indeterminate: true });
  key('Enter'); key('Enter');
  expect(progress[progress.length - 1]).toMatchObject({ mode: 'local', current: 0, total: 2, percentage: 0 });
  key('Enter'); expect(progress[progress.length - 1]).toMatchObject({ current: 1, total: 2, percentage: 50 });
});
it('keeps future conditional progress indeterminate until reached', () => {
  const { progress } = setup({ id: 'flow', label: 'Flow', progress: 'local', steps: [step('one'), { ...step('two'), when: a => a.one === 'a' }], run: vi.fn() });
  key('Enter'); expect(progress[progress.length - 1]?.total).toBeNull(); key('Enter');
  expect(progress[progress.length - 1]).toMatchObject({ current: 1, total: 2, indeterminate: false });
});

it('does not restore a forward destination after switching siblings', () => {
  setup({ id: 'root', label: 'Root', arrowNavigation: true, commands: [
    { id: 'first', label: 'First', steps: [step('first step')], run: vi.fn() },
    { id: 'second', label: 'Second', steps: [step('second step')], run: vi.fn() }
  ] });
  key('Enter'); key('Enter'); key('ArrowLeft'); key('ArrowDown'); key('Enter');
  key('ArrowLeft'); key('ArrowRight'); expect(screen.getByRole('combobox', { name: 'second step' })).toBeTruthy();
});
it('keeps progress and active descendants correct with a large bounded option list', () => {
  const options = Array.from({ length: 10001 }, (_, i) => ({ value: String(i), label: `Item ${i}` }));
  const { progress } = setup({ id: 'large', label: 'Large', progress: 'local', maxVisibleItems: 5, steps: [{ id: 'choice', label: 'Choice', options }, step('next')], run: vi.fn() });
  key('Enter'); key('ArrowUp');
  expect(screen.getAllByRole('option').length).toBeLessThanOrEqual(5);
  const active = document.getElementById(screen.getByRole('combobox').getAttribute('aria-activedescendant')!);
  expect(active?.textContent).toBe('Item 10000'); expect(progress[progress.length - 1]?.total).toBe(2);
  key('Enter'); expect(progress[progress.length - 1]?.current).toBe(1);
});
it('does not forward through an async failure or a changed saved option', async () => {
  const load = vi.fn().mockResolvedValueOnce(options).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([options[1]]);
  setup({ id: 'flow', label: 'Flow', arrowNavigation: true, steps: [{ id: 'one', label: 'one', options: load }, step('two')], run: vi.fn() });
  key('Enter'); await screen.findByRole('option', { name: 'A' }); key('Enter'); key('ArrowLeft');
  await screen.findByRole('alert'); key('ArrowRight'); expect(screen.getByRole('combobox', { name: 'one' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' })); await screen.findByRole('option', { name: 'B' });
  key('ArrowRight'); expect(screen.getByRole('combobox', { name: 'one' })).toBeTruthy();
});
it('leaves progress and arrows disabled for ordinary commands', () => {
  const { progress } = setup({ id: 'flow', label: 'Flow', steps: [step('one'), step('two')], run: vi.fn() });
  key('Enter'); key('Enter'); key('ArrowLeft');
  expect(screen.getByRole('combobox', { name: 'two' })).toBeTruthy(); expect(progress).toHaveLength(0);
});
