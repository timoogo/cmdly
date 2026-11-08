import { describe, expect, it, vi } from 'vitest';
import { createCommandEngine, createCommandRegistry } from '@cmdly/core';

describe('required runtime at mounted callback boundaries', () => {
  it.each(['step predicate', 'step options', 'final before', 'final after'] as const)(
    'does not invoke the %s without the owner runtime', async boundary => {
      const root = createCommandRegistry();
      const child = createCommandRegistry({ shared: { owner: 'child' }, runtimeRequired: true });
      const callback = vi.fn(() => true), options = vi.fn(async () => [{ value: 'x', label: 'X' }]);
      const finalWhen = vi.fn(() => true), render = vi.fn(), run = vi.fn(), onExecute = vi.fn();
      child.register({
        id: 'a', label: 'A',
        steps: boundary === 'step predicate' ? [{ id: 's', label: 'S', when: callback, options: [] }]
          : boundary === 'step options' ? [{ id: 's', label: 'S', options }] : undefined,
        finalStep: boundary === 'final before' || boundary === 'final after'
          ? { timing: boundary === 'final before' ? 'before' : 'after', when: finalWhen, render } : undefined,
        run,
      });
      root.mount('child', child);
      const engine = createCommandEngine({ registry: root, runtime: async () => undefined, callbacks: { onExecute } });
      engine.select(0);
      await vi.waitFor(() => expect(engine.getSnapshot().error).toBeTruthy());
      expect(callback).not.toHaveBeenCalled();
      expect(options).not.toHaveBeenCalled();
      expect(finalWhen).not.toHaveBeenCalled();
      expect(render).not.toHaveBeenCalled();
      expect(run).not.toHaveBeenCalled();
      expect(onExecute).not.toHaveBeenCalled();
      engine.destroy();
    },
  );
});

describe('closed registry engine', () => {
  it('does not prepare another runtime when refreshRegistry is called after close', () => {
    const registry = createCommandRegistry({ shared: { owner: 'owner' }, runtimeRequired: true });
    const provider = vi.fn(() => 'runtime');
    registry.register({ id: 'a', label: 'A', when: () => true, run: () => {} });
    const engine = createCommandEngine({ registry, runtime: provider });
    engine.close();
    const snapshot = engine.getSnapshot();
    engine.refreshRegistry();
    expect(provider).toHaveBeenCalledOnce();
    expect(engine.getSnapshot()).toBe(snapshot);
    engine.destroy();
  });
});

describe('registry error notifications', () => {
  it('reports an invalidated mount once when async preparation finishes', async () => {
    const root = createCommandRegistry();
    const child = createCommandRegistry({ shared: { owner: 'child' }, runtimeRequired: true });
    const onError = vi.fn();
    let resolveRuntime!: (value: string) => void;
    child.register({ id: 'group', label: 'Group', commands: [{ id: 'nested', label: 'Nested', when: () => true, run: () => {} }] });
    const unmount = root.mount('child', child);
    const engine = createCommandEngine({ registry: root, runtime: () => new Promise<string>(resolve => { resolveRuntime = resolve; }), callbacks: { onError } });
    engine.select(0);
    unmount(); resolveRuntime('ready');
    await vi.waitFor(() => expect(engine.getSnapshot().error).toBeTruthy());
    expect(onError).toHaveBeenCalledOnce();
    engine.destroy();
  });

  it('does not repeatedly report the same missing runtime on search changes', () => {
    const root = createCommandRegistry();
    const child = createCommandRegistry({ shared: { owner: 'child' }, runtimeRequired: true });
    const predicate = vi.fn(() => true), onError = vi.fn();
    child.register({ id: 'a', label: 'A', when: predicate, run: () => {} });
    root.mount('child', child);
    const engine = createCommandEngine({ registry: root, callbacks: { onError } });
    engine.setQuery('a'); engine.setQuery('b'); engine.setQuery('');
    expect(predicate).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
    engine.destroy();
  });
});

describe('multiple stale registry entries', () => {
  it('reports each unavailable command only once across menu rebuilds', () => {
    const root = createCommandRegistry();
    const child = createCommandRegistry({ shared: { owner: 'child' } });
    child.registerMany([{ id: 'a', label: 'A', run: () => {} }, { id: 'b', label: 'B', run: () => {} }]);
    const unmount = root.mount('child', child), onError = vi.fn();
    const engine = createCommandEngine({ registry: root, callbacks: { onError } });
    unmount();
    engine.setQuery('a'); engine.setQuery('b'); engine.setQuery('');
    expect(onError).toHaveBeenCalledTimes(2);
    engine.destroy();
  });
});
