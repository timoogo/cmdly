import { describe, expect, it, vi } from 'vitest';
import { createCommandEngine, createCommandRegistry } from '@cmdly/core';

type Runtime = { userId: string };
const finalStep = { timing: 'before' as const, closeOnComplete: false };
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};

describe('extension context safety', () => {
  it('exposes the active command owner and runtime to plugin subscribers', async () => {
    const shared = { owner: 'child' }, runtime = { userId: 'alice' };
    const root = createCommandRegistry<{ owner: string }, Runtime>({ shared: { owner: 'root' }, runtimeRequired: true });
    const child = createCommandRegistry<typeof shared, Runtime>({ shared, runtimeRequired: true });
    child.register({ id: 'publish', label: 'Publish', finalStep, run: () => {} }); root.mount('child', child);
    const seen: unknown[] = [];
    const engine = createCommandEngine({ registry: root, runtime: () => runtime, plugins: [{ setup(pluginEngine) {
      return pluginEngine.subscribe(() => { if (pluginEngine.getSnapshot().command) seen.push(pluginEngine.getSnapshot().context); });
    } }] });
    await vi.waitFor(() => expect(engine.getSnapshot().items).toHaveLength(1));
    engine.select(0); await engine.execute();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen).toContainEqual({ shared, runtime });
    engine.destroy();
  });

  it('reports a strategy failure after one execution with its context', async () => {
    const shared = { owner: 'owner' }, runtime = { userId: 'alice' }, failure = new Error('strategy failed');
    const registry = createCommandRegistry<typeof shared, Runtime>({ shared, runtimeRequired: true });
    const run = vi.fn(), onError = vi.fn(); registry.register({ id: 'publish', label: 'Publish', finalStep, run });
    const strategy = vi.fn((..._args: unknown[]) => { throw failure; });
    const engine = createCommandEngine({ registry, runtime: () => runtime, callbacks: { onError }, strategies: { closeOnComplete: strategy } });
    await vi.waitFor(() => expect(engine.getSnapshot().items).toHaveLength(1));
    engine.select(0); await engine.execute();
    expect(run).toHaveBeenCalledOnce();
    expect(strategy.mock.calls[0][3]).toEqual({ shared, runtime });
    expect(engine.getSnapshot().error).toBe(failure);
    expect(onError.mock.calls[0][2]).toEqual({ shared, runtime });
    engine.destroy();
  });

  it('does not start execution if a final predicate invalidates the registration', async () => {
    const registry = createCommandRegistry<{ owner: string }, Runtime>({ shared: { owner: 'owner' }, runtimeRequired: true });
    const run = vi.fn(); let unregister = () => {};
    unregister = registry.register({ id: 'publish', label: 'Publish', finalStep: { timing: 'before', when: () => { unregister(); return true; } }, run });
    const engine = createCommandEngine({ registry, runtime: () => ({ userId: 'alice' }) });
    await vi.waitFor(() => expect(engine.getSnapshot().items).toHaveLength(1));
    engine.select(0); await engine.execute();
    expect(run).not.toHaveBeenCalled();
    expect(engine.getSnapshot().error).toBeTruthy();
    engine.destroy();
  });

  it('does not call onExecute after a subscriber destroys the engine during publication', async () => {
    const registry = createCommandRegistry<{ owner: string }, Runtime>({ shared: { owner: 'owner' }, runtimeRequired: true });
    const run = vi.fn(), onExecute = vi.fn(); registry.register({ id: 'publish', label: 'Publish', finalStep, run });
    const engine = createCommandEngine({ registry, runtime: () => ({ userId: 'alice' }), callbacks: { onExecute } });
    await vi.waitFor(() => expect(engine.getSnapshot().items).toHaveLength(1));
    engine.select(0);
    engine.subscribe(() => { if (engine.getSnapshot().running) engine.destroy(); });
    await engine.execute();
    expect(onExecute).not.toHaveBeenCalled(); expect(run).not.toHaveBeenCalled();
  });

  it('keeps captured contexts for concurrently started runs after invalidation', async () => {
    const shared = { owner: 'owner' };
    const registry = createCommandRegistry<typeof shared, Runtime>({ shared, runtimeRequired: true });
    const pending = deferred<void>(), seen: Array<{ shared: typeof shared; runtime: Runtime }> = [];
    const unregister = registry.register({ id: 'publish', label: 'Publish', finalStep, run: async (_answers, context) => { await pending.promise; seen.push(context); } });
    const first = createCommandEngine({ registry, runtime: () => ({ userId: 'alice' }) });
    const second = createCommandEngine({ registry, runtime: () => ({ userId: 'bob' }) });
    await vi.waitFor(() => expect(first.getSnapshot().items).toHaveLength(1));
    await vi.waitFor(() => expect(second.getSnapshot().items).toHaveLength(1));
    first.select(0); second.select(0);
    const a = first.execute(), b = second.execute();
    unregister(); pending.resolve(); await Promise.all([a, b]);
    expect(seen).toEqual([{ shared, runtime: { userId: 'alice' } }, { shared, runtime: { userId: 'bob' } }]);
    first.destroy(); second.destroy();
  });
});

describe('invocation context boundaries', () => {
  it('does not expose a sibling invocation override after navigating back', async () => {
    const registry = createCommandRegistry<{ owner: string }, Runtime>({ shared: { owner: 'owner' }, runtimeRequired: true });
    registry.register({ id: 'group', label: 'Group', commands: [
      { id: 'a', label: 'A', finalStep, run: () => {} },
      { id: 'b', label: 'B', finalStep, run: () => {} },
    ] });
    const engine = createCommandEngine({ registry, runtime: () => ({ userId: 'session' }) });
    await vi.waitFor(() => expect(engine.getSnapshot().items).toHaveLength(1));
    engine.select(0); engine.select(0);
    await engine.execute({ runtime: { userId: 'override' } });
    engine.back(); engine.select(1);
    expect(engine.getSnapshot().command?.label).toBe('B');
    expect(engine.getSnapshot().context).toBeUndefined();
    engine.destroy();
  });

  it('lets a started run finish after invalidation without invoking subsequent callbacks', async () => {
    const registry = createCommandRegistry<{ owner: string }, Runtime>({ shared: { owner: 'owner' }, runtimeRequired: true });
    const pending = deferred<string>(), strategy = vi.fn(() => false), run = vi.fn(() => pending.promise);
    const unregister = registry.register({ id: 'publish', label: 'Publish', finalStep, run });
    const engine = createCommandEngine({ registry, runtime: () => ({ userId: 'alice' }), strategies: { closeOnComplete: strategy } });
    await vi.waitFor(() => expect(engine.getSnapshot().items).toHaveLength(1));
    engine.select(0); const execution = engine.execute();
    expect(run).toHaveBeenCalledOnce();
    unregister(); pending.resolve('done'); await execution;
    expect(engine.getSnapshot().status).toBe('success');
    expect(engine.getSnapshot().result).toBe('done');
    expect(strategy).not.toHaveBeenCalled();
    engine.destroy();
  });
});

describe('headless final renderer', () => {
  it('supplies the registered context when the snapshot renderer is called with its historical argument', async () => {
    const shared = { owner: 'child' }, runtime = { userId: 'alice' };
    const root = createCommandRegistry<{ owner: string }, Runtime>({ shared: { owner: 'root' }, runtimeRequired: true });
    const child = createCommandRegistry<typeof shared, Runtime>({ shared, runtimeRequired: true });
    const render = vi.fn((_final, context: { shared: typeof shared; runtime: Runtime }) => context.runtime.userId);
    child.register({ id: 'publish', label: 'Publish', finalStep: { timing: 'before', render }, run: () => {} });
    root.mount('child', child);
    const engine = createCommandEngine({ registry: root, runtime: () => runtime });
    await vi.waitFor(() => expect(engine.getSnapshot().items).toHaveLength(1));
    engine.select(0);
    const snapshot = engine.getSnapshot();
    const final = { answers: snapshot.answers, summary: snapshot.summary, status: snapshot.status, error: snapshot.error, result: snapshot.result, execute: () => engine.execute(), back: () => engine.back(), close: () => engine.close() };
    expect(snapshot.finalStep?.render?.(final)).toBe('alice');
    expect(render.mock.calls[0][1]).toEqual({ shared, runtime });
    engine.destroy();
  });
});

describe('final predicate cancellation', () => {
  it('does not run or reopen the workflow when the final predicate closes the engine', async () => {
    const registry = createCommandRegistry<{ owner: string }, Runtime>({ shared: { owner: 'owner' }, runtimeRequired: true });
    const run = vi.fn();
    let close = () => {};
    registry.register({ id: 'publish', label: 'Publish', finalStep: { timing: 'before', when: () => { close(); return true; } }, run });
    const engine = createCommandEngine({ registry, runtime: () => ({ userId: 'alice' }) });
    close = () => engine.close();
    await vi.waitFor(() => expect(engine.getSnapshot().items).toHaveLength(1));
    engine.select(0); await engine.execute();
    expect(engine.getSnapshot().closed).toBe(true);
    expect(run).not.toHaveBeenCalled();
    engine.destroy();
  });
});

describe('final renderer provenance and required runtime', () => {
  it('never invokes a final renderer when the required runtime is absent', async () => {
    const registry = createCommandRegistry<{ owner: string }, Runtime>({ shared: { owner: 'owner' }, runtimeRequired: true });
    const render = vi.fn(), run = vi.fn();
    registry.register({ id: 'publish', label: 'Publish', finalStep: { timing: 'before', render }, run });
    const engine = createCommandEngine({ registry, runtime: () => undefined as unknown as Runtime });
    await vi.waitFor(() => expect(engine.getSnapshot().items).toHaveLength(1));
    engine.select(0); await engine.execute();
    expect(render).not.toHaveBeenCalled(); expect(run).not.toHaveBeenCalled();
    expect(engine.getSnapshot().error).toBeTruthy();
    expect(engine.getSnapshot().finalStep?.render).toBeUndefined();
    engine.destroy();
  });

  it('does not invoke a captured renderer after its registration is removed and refreshed', async () => {
    const registry = createCommandRegistry<{ owner: string }, Runtime>({ shared: { owner: 'owner' }, runtimeRequired: true });
    const render = vi.fn(() => 'rendered');
    const unregister = registry.register({ id: 'publish', label: 'Publish', finalStep: { timing: 'before', render }, run: () => {} });
    const engine = createCommandEngine({ registry, runtime: () => ({ userId: 'alice' }) });
    await vi.waitFor(() => expect(engine.getSnapshot().items).toHaveLength(1));
    engine.select(0);
    const snapshot = engine.getSnapshot(), captured = snapshot.finalStep?.render;
    expect(captured).toBeDefined();
    const final = { answers: snapshot.answers, summary: snapshot.summary, status: snapshot.status, error: snapshot.error, result: snapshot.result, execute: () => engine.execute(), back: () => engine.back(), close: () => engine.close() };
    unregister(); engine.refreshRegistry();
    expect(() => captured?.(final)).not.toThrow();
    expect(render).not.toHaveBeenCalled();
    engine.destroy();
  });
});
