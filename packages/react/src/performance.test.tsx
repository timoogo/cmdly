// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CommandPalette, type Command } from '@cmdly/react';

afterEach(cleanup);

it('windows large results without re-filtering on navigation and keeps active semantics correct', () => {
  let reads = 0;
  const run = vi.fn();
  const options = Array.from({ length: 10000 }, (_, i) => ({ value: String(i), get label() { reads++; return `Option ${i}`; } }));
  const commands: Command[] = [{ id: 'large', label: 'Large', run, maxVisibleItems: 7, steps: [{ id: 'choice', label: 'Choice', options }] }];
  render(<CommandPalette commands={commands} open onOpenChange={() => {}} />);
  const input = screen.getByRole('combobox');
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(screen.getAllByRole('option')).toHaveLength(7);
  fireEvent.change(input, { target: { value: 'Option 9' } });
  reads = 0;
  for (let i = 0; i < 8; i++) fireEvent.keyDown(input, { key: 'ArrowDown' });
  expect(reads).toBeLessThan(100);
  const active = document.getElementById(input.getAttribute('aria-activedescendant')!);
  expect(active?.textContent).toBe('Option 97');
  expect(active?.getAttribute('aria-selected')).toBe('true');
  expect(active?.getAttribute('aria-posinset')).toBe('9');
  expect(active?.getAttribute('aria-setsize')).toBe('1111');
  expect(screen.getAllByRole('option')).toHaveLength(7);
  fireEvent.change(input, { target: { value: 'Option 9999' } });
  expect(screen.getAllByRole('option')).toHaveLength(1);
  expect(document.getElementById(input.getAttribute('aria-activedescendant')!)?.textContent).toBe('Option 9999');
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(run).toHaveBeenCalledWith({ choice: '9999' });
});

it('wraps across the full dataset and keeps the active item mounted and scrolled into view', () => {
  const scroll = vi.fn();
  const previous = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView = scroll;
  try {
    const options = Array.from({ length: 10000 }, (_, i) => ({ value: String(i), label: `Option ${i}` }));
    render(<CommandPalette commands={[{ id: 'large', label: 'Large', run: vi.fn(), steps: [{ id: 'choice', label: 'Choice', options }] }]} open onOpenChange={() => {}} />);
    const input = screen.getByRole('combobox');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getAllByRole('option')).toHaveLength(50);
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(document.getElementById(input.getAttribute('aria-activedescendant')!)?.textContent).toBe('Option 9999');
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(document.getElementById(input.getAttribute('aria-activedescendant')!)?.textContent).toBe('Option 0');
    fireEvent.change(input, { target: { value: 'no matches' } });
    expect(input.hasAttribute('aria-activedescendant')).toBe(false);
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  } finally { HTMLElement.prototype.scrollIntoView = previous; }
});

it('keeps keyboard selection across window boundaries and accepts real pointer movement', () => {
  const run = vi.fn();
  const options = Array.from({ length: 10001 }, (_, i) => ({ value: String(i), label: `Option ${i}` }));
  render(<CommandPalette commands={[{ id: 'large', label: 'Large', maxVisibleItems: 3, steps: [{ id: 'item', label: 'Item', options }], run }]} open onOpenChange={() => {}} />);
  const input = screen.getByRole('combobox');
  fireEvent.keyDown(input, { key: 'Enter' });
  fireEvent.mouseMove(screen.getByText('Option 0'), { clientX: 10, clientY: 10 });
  for (let i = 0; i < 4; i++) fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.mouseMove(screen.getByText('Option 3'), { clientX: 10, clientY: 10 });
  expect(document.getElementById(input.getAttribute('aria-activedescendant')!)?.textContent).toBe('Option 4');
  fireEvent.keyDown(input, { key: 'ArrowUp' });
  fireEvent.keyDown(input, { key: 'ArrowUp' });
  expect(document.getElementById(input.getAttribute('aria-activedescendant')!)?.textContent).toBe('Option 2');
  fireEvent.mouseMove(screen.getByText('Option 1'), { clientX: 11, clientY: 10 });
  expect(document.getElementById(input.getAttribute('aria-activedescendant')!)?.textContent).toBe('Option 1');
  for (let i = 0; i < 4; i++) fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(run).toHaveBeenCalledWith({ item: '5' });
});

it('applies the command limit to each step and resets selection on search and back', () => {
  const run = vi.fn();
  const options = Array.from({ length: 8 }, (_, i) => ({ value: String(i), label: `Option ${i}` }));
  render(<CommandPalette commands={[{ id: 'flow', label: 'Flow', maxVisibleItems: 2, steps: [{ id: 'first', label: 'First', options }, { id: 'second', label: 'Second', options }], run }]} open onOpenChange={() => {}} />);
  const input = screen.getByRole('combobox');
  fireEvent.keyDown(input, { key: 'Enter' });
  for (let i = 0; i < 4; i++) fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.change(input, { target: { value: 'Option 7' } });
  expect(document.getElementById(input.getAttribute('aria-activedescendant')!)?.textContent).toBe('Option 7');
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(screen.getAllByRole('option')).toHaveLength(2);
  expect(document.getElementById(input.getAttribute('aria-activedescendant')!)?.textContent).toBe('Option 0');
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(screen.getByRole('combobox').getAttribute('aria-label')).toBeNull();
  expect(document.getElementById(input.getAttribute('aria-activedescendant')!)?.textContent).toBe('Option 7');
  fireEvent.keyDown(input, { key: 'Enter' });
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(run).toHaveBeenCalledWith({ first: '7', second: '1' });
});
