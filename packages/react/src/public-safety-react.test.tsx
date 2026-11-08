// @vitest-environment jsdom
import { it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { createCommandEngine, createCommandRegistry, useCommandEngine, type Command } from '@cmdly/react';

it('exposes safe registry views in React while retaining the historical hook type', () => {
  const registry = createCommandRegistry<{ value: number }, string>({ shared: { value: 1 }, runtimeRequired: true });
  registry.register({ id: 'a', label: 'A', run: () => {} });
  const engine = createCommandEngine({ registry, runtime: () => 'id' });
  const { result, unmount } = renderHook(() => useCommandEngine(engine));
  expect(result.current.state.items[0].label).toBe('A');
  if (false) {
    // @ts-expect-error React registry snapshots expose views
    result.current.state.command?.run({});
    result.current.actions.execute({ runtime: 'ok' });
  }
  const legacy = createCommandEngine({ commands: [] });
  const hook = renderHook(() => useCommandEngine(legacy));
  const command: Command | null = hook.result.current.state.command;
  expect(command).toBeNull(); hook.unmount(); unmount(); legacy.destroy(); engine.destroy();
});
