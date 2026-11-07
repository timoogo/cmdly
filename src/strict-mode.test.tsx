// @vitest-environment jsdom
import React, { StrictMode } from 'react';
import { expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { CommandPalette } from './index';

it('cleans up every plugin setup in StrictMode', async () => {
  const cleanup = vi.fn();
  const setup = vi.fn(() => cleanup);
  const view = render(<StrictMode><CommandPalette open onOpenChange={() => {}} commands={[{ id: 'a', label: 'A', run: () => {} }]} plugins={[{ setup }]} /></StrictMode>);
  expect(setup).toHaveBeenCalledTimes(2);
  expect(cleanup).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(cleanup).toHaveBeenCalledTimes(2);
});

it('cleans up remaining plugins if a cleanup fails', () => {
  const last = vi.fn();
  const failing = vi.fn(() => { throw new Error('cleanup failed'); });
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const view = render(<CommandPalette open onOpenChange={() => {}} commands={[]} plugins={[{ setup: () => last }, { setup: () => failing }]} />);
    expect(() => view.unmount()).toThrow('cleanup failed');
    expect(failing).toHaveBeenCalledOnce();
    expect(last).toHaveBeenCalledOnce();
  } finally { consoleError.mockRestore(); }
});

it('reports setup and cleanup errors together', () => {
  const cleanup = vi.fn(() => { throw new Error('cleanup failed'); });
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    expect(() => render(<CommandPalette open onOpenChange={() => {}} commands={[]} plugins={[{ setup: () => cleanup }, { setup: () => { throw new Error('setup failed'); } }]} />)).toThrow('Plugin setup failed (Error: setup failed); cleanup also failed (Error: cleanup failed)');
    expect(cleanup).toHaveBeenCalledOnce();
  } finally { consoleError.mockRestore(); }
});
