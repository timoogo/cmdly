import { describe, expect, it, vi } from 'vitest';
import { createCommandEngine, createCommandRegistry } from './index';

type Runtime = { userId: string };
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};

describe('context propagation through a workflow', () => {
  it('uses the owning registry and one runtime through predicates, options and execution', async () => {
    const shared = { name: 'child' };
    const root = createCommandRegistry<{ name: string }, Runtime>({ shared: { name: 'root' }, runtimeRequired: true });
    const child = createCommandRegistry<typeof shared, Runtime>({ shared, runtimeRequired: true });
    const observations: Array<[string, unknown, unknown]> = [];
    const record = (name: string, context: { shared: typeof shared; runtime: Runtime }) => {
      observations.push([name, context.shared, context.runtime]);
    };
    child.register({
      id: 'group', label: 'Group',
      when: (_answers, context) => { record('command', context); return true; },
      commands: [{
        id: 'publish', label: 'Publish',
        steps: [{
          id: 'category', label: 'Category',
          when: (_answers, context) => { record('step', context); return true; },
          options: async (_answers, context) => { record('options', context); return [{ value: 'news', label: 'News' }]; },
        }],
        finalStep: { timing: 'before', closeOnComplete: false },
        run: (_answers, context) => { record('run', context); },
      }],
    });
    root.mount('child', child);
    const runtime = { userId: 'alice' };
    const provider = vi.fn(() => runtime);
    const engine = createCommandEngine({ registry: root, runtime: provider });
    await vi.waitFor(() => expect(engine.getSnapshot().items).toHaveLength(1));
    engine.select(0);
    await vi.waitFor(() => expect(engine.getSnapshot().items).toHaveLength(1));
    engine.select(0);
    await vi.waitFor(() => expect(engine.getSnapshot().items).toEqual([{ value: 'news', label: 'News' }]));
    engine.select(0);
    await engine.execute();
    expect(observations.map(([name]) => name)).toEqual(expect.arrayContaining(['command', 'step', 'options', 'run']));
    for (const [, actualShared, actualRuntime] of observations) {
      expect(actualShared).toBe(shared);
      expect(actualRuntime).toBe(runtime);
    }
    expect(provider).toHaveBeenCalledOnce();
    engine.destroy();
  });

  it('ignores options that resolve after the workflow has been abandoned', async () => {
    const registry = createCommandRegistry<{ name: string }, Runtime>({ shared: { name: 'owner' }, runtimeRequired: true });
    const pending = deferred<{ value: string; label: string }[]>();
    const started = vi.fn();
    registry.register({ id: 'load', label: 'Load', steps: [{ id: 'choice', label: 'Choice', options: (_answers, context) => {
      started(context.runtime.userId); return pending.promise;
    } }], run: () => {} });
    const engine = createCommandEngine({ registry, runtime: () => ({ userId: 'alice' }) });
    await vi.waitFor(() => expect(engine.getSnapshot().items).toHaveLength(1));
    engine.select(0);
    await vi.waitFor(() => expect(started).toHaveBeenCalledWith('alice'));
    engine.close();
    pending.resolve([{ value: 'late', label: 'Late' }]);
    await pending.promise;
    await Promise.resolve();
    expect(engine.getSnapshot().closed).toBe(true);
    expect(engine.getSnapshot().items).not.toContainEqual({ value: 'late', label: 'Late' });
    engine.destroy();
  });
});
