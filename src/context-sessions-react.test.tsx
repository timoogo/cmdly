// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { createCommandEngine, createCommandRegistry, useCommandEngine } from './index';

it('reflects async runtime preparation and retains the session across React rerenders', async () => {
  let resolve!: (runtime: { userId: string }) => void;
  const pending = new Promise<{ userId: string }>(done => { resolve = done; });
  const provider = vi.fn(() => pending);
  const registry = createCommandRegistry<{ allowed: string }, { userId: string }>({ shared: { allowed: 'alice' }, runtimeRequired: true });
  registry.register({ id: 'publish', label: 'Publish', when: (_answers, context) => context.shared.allowed === context.runtime.userId, run: () => {} });
  const engine = createCommandEngine({ registry, runtime: provider });
  const { result, rerender, unmount } = renderHook(() => useCommandEngine(engine));
  expect(result.current.state.loading).toBe(true);
  expect(result.current.state.items).toHaveLength(0);
  await act(async () => { resolve({ userId: 'alice' }); await pending; });
  await waitFor(() => expect(result.current.state.items.map(item => item.label)).toEqual(['Publish']));
  rerender();
  expect(result.current.state.loading).toBe(false);
  expect(result.current.state.items.map(item => item.label)).toEqual(['Publish']);
  expect(provider).toHaveBeenCalledOnce();
  unmount(); engine.destroy();
});
