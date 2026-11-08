import { describe, expect, it, vi } from 'vitest';
import { createCommandEngine, createCommandRegistry } from '@cmdly/core';

type Runtime = { userId: string };
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
const finalStep = { timing: 'before' as const, closeOnComplete: false };

describe('context session isolation and provenance', () => {
  it('waits for asynchronous runtime before evaluating visibility and ignores an invalidated registration', async () => {
    const registry = createCommandRegistry<{ owner: string }, Runtime>({ shared: { owner: 'old' }, runtimeRequired: true });
    const runtime = deferred<Runtime>();
    const when = vi.fn((_answers, context: { shared: { owner: string }; runtime: Runtime }) => !!context.runtime.userId);
    const run = vi.fn();
    const unregister = registry.register({ id: 'publish', label: 'Old', when, finalStep, run });
    const engine = createCommandEngine({ registry, runtime: () => runtime.promise });
    expect(engine.getSnapshot().loading).toBe(true);
    expect(when).not.toHaveBeenCalled();
    unregister();
    registry.register({ id: 'publish', label: 'Replacement', finalStep, run });
    runtime.resolve({ userId: 'alice' });
    await runtime.promise;
    await vi.waitFor(() => expect(engine.getSnapshot().loading).toBe(false));
    expect(when).not.toHaveBeenCalled();
    engine.select(0);
    await engine.execute();
    expect(run).not.toHaveBeenCalled();
    engine.destroy();
  });

  it('keeps concurrent workflows and their runtime values independent', async () => {
    const registry = createCommandRegistry<{ owner: string }, Runtime>({ shared: { owner: 'owner' }, runtimeRequired: true });
    const runs: string[] = [];
    const finish = deferred<void>();
    registry.register({ id: 'publish', label: 'Publish', finalStep,
      when: (_answers, context) => context.runtime.userId.length > 0,
      run: async (_answers, context) => { await finish.promise; runs.push(context.runtime.userId); },
    });
    const first = createCommandEngine({ registry, runtime: () => ({ userId: 'alice' }) });
    const second = createCommandEngine({ registry, runtime: () => ({ userId: 'bob' }) });
    await vi.waitFor(() => expect(first.getSnapshot().items).toHaveLength(1));
    await vi.waitFor(() => expect(second.getSnapshot().items).toHaveLength(1));
    first.select(0); second.select(0);
    const a = first.execute(), b = second.execute();
    finish.resolve();
    await Promise.all([a, b]);
    expect(runs.sort()).toEqual(['alice', 'bob']);
    first.destroy(); second.destroy();
  });

  it('does not reuse an authorization decision with a different explicit runtime', async () => {
    const registry = createCommandRegistry<{ owner: string }, Runtime>({ shared: { owner: 'owner' }, runtimeRequired: true });
    const run = vi.fn();
    registry.register({ id: 'publish', label: 'Publish', finalStep,
      when: (_answers, context) => context.runtime.userId === 'alice', run,
    });
    const engine = createCommandEngine({ registry, runtime: () => ({ userId: 'alice' }) });
    await vi.waitFor(() => expect(engine.getSnapshot().items).toHaveLength(1));
    engine.select(0);
    await engine.execute({ runtime: { userId: 'bob' } });
    expect(run).not.toHaveBeenCalled();
    expect(engine.getSnapshot().error).toBeTruthy();
    engine.destroy();
  });
});

describe('context session cancellation and navigation', () => {
  it('does not accept asynchronous options after the command is unregistered', async () => {
    const registry = createCommandRegistry<{ owner: string }, Runtime>({ shared: { owner: 'old' }, runtimeRequired: true });
    const pending = deferred<{ value: string; label: string }[]>(), started = vi.fn();
    const unregister = registry.register({ id: 'publish', label: 'Publish', steps: [{
      id: 'category', label: 'Category', options: (_answers, context) => { started(context.runtime.userId); return pending.promise; },
    }], finalStep, run: vi.fn() });
    const engine = createCommandEngine({ registry, runtime: () => ({ userId: 'alice' }) });
    await vi.waitFor(() => expect(engine.getSnapshot().items).toHaveLength(1));
    engine.select(0);
    await vi.waitFor(() => expect(started).toHaveBeenCalledOnce());
    unregister();
    pending.resolve([{ value: 'old', label: 'Old option' }]);
    await pending.promise;
    await Promise.resolve();
    expect(engine.getSnapshot().items).not.toContainEqual({ value: 'old', label: 'Old option' });
    engine.destroy();
  });

  it.each(['close', 'destroy'] as const)('abandons pending runtime preparation on %s', async action => {
    const registry = createCommandRegistry<{ owner: string }, Runtime>({ shared: { owner: 'owner' }, runtimeRequired: true });
    const pending = deferred<Runtime>();
    const when = vi.fn((_answers, context: { shared: { owner: string }; runtime: Runtime }) => !!context.runtime.userId);
    registry.register({ id: 'publish', label: 'Publish', when, run: vi.fn() });
    const engine = createCommandEngine({ registry, runtime: () => pending.promise });
    expect(engine.getSnapshot().loading).toBe(true);
    engine[action]();
    pending.resolve({ userId: 'alice' });
    await pending.promise;
    await Promise.resolve();
    expect(when).not.toHaveBeenCalled();
    if (action === 'close') expect(engine.getSnapshot().closed).toBe(true);
    engine.destroy();
  });

  it('retains the same runtime while navigating back and forward', async () => {
    const registry = createCommandRegistry<{ owner: string }, Runtime>({ shared: { owner: 'owner' }, runtimeRequired: true });
    const runtime = { userId: 'alice' }, observed: Runtime[] = [];
    const provider = vi.fn(() => runtime);
    registry.register({ id: 'publish', label: 'Publish', steps: [
      { id: 'first', label: 'First', options: [{ value: 'yes', label: 'Yes' }] },
      { id: 'second', label: 'Second', when: (_answers, context) => { observed.push(context.runtime); return true; }, options: [{ value: 'ok', label: 'OK' }] },
    ], finalStep, run: () => {} });
    const engine = createCommandEngine({ registry, runtime: provider });
    await vi.waitFor(() => expect(engine.getSnapshot().items).toHaveLength(1));
    engine.select(0); engine.select(0);
    expect(engine.getSnapshot().step?.id).toBe('second');
    engine.back();
    expect(engine.getSnapshot().step?.id).toBe('first');
    engine.forward();
    expect(engine.getSnapshot().step?.id).toBe('second');
    expect(observed.length).toBeGreaterThan(0);
    expect(observed.every(value => value === runtime)).toBe(true);
    expect(provider).toHaveBeenCalledOnce();
    engine.destroy();
  });

  it('does not evaluate visibility or run without a required runtime', async () => {
    const registry = createCommandRegistry<{ owner: string }, Runtime>({ shared: { owner: 'owner' }, runtimeRequired: true });
    const when = vi.fn(() => true), run = vi.fn();
    registry.register({ id: 'publish', label: 'Publish', when, run });
    const engine = createCommandEngine({ registry, runtime: () => undefined as unknown as Runtime });
    await vi.waitFor(() => expect(engine.getSnapshot().error).toBeTruthy());
    engine.select(0);
    await engine.execute();
    expect(when).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    engine.destroy();
  });

  it('reports a predicate failure and never treats it as authorization', async () => {
    const registry = createCommandRegistry<{ owner: string }, Runtime>({ shared: { owner: 'owner' }, runtimeRequired: true });
    const failure = new Error('predicate failed'), run = vi.fn();
    registry.register({ id: 'publish', label: 'Publish', when: () => { throw failure; }, run });
    const engine = createCommandEngine({ registry, runtime: () => ({ userId: 'alice' }) });
    await vi.waitFor(() => expect(engine.getSnapshot().error).toBe(failure));
    engine.select(0);
    await engine.execute();
    expect(run).not.toHaveBeenCalled();
    engine.destroy();
  });
});

describe('context preparation and synchronous options', () => {
  it('passes the session context to synchronous options', async () => {
    const shared = { owner: 'owner' }, runtime = { userId: 'alice' };
    const registry = createCommandRegistry<typeof shared, Runtime>({ shared, runtimeRequired: true });
    const options = vi.fn((_answers, context: { shared: typeof shared; runtime: Runtime }) => [{ value: context.runtime.userId, label: context.shared.owner }]);
    registry.register({ id: 'choice', label: 'Choice', steps: [{ id: 'one', label: 'One', options }], finalStep, run: () => {} });
    const engine = createCommandEngine({ registry, runtime: () => runtime });
    await vi.waitFor(() => expect(engine.getSnapshot().items).toHaveLength(1));
    engine.select(0);
    await vi.waitFor(() => expect(engine.getSnapshot().items).toEqual([{ value: 'alice', label: 'owner' }]));
    expect(options).toHaveBeenCalledWith({}, { shared, runtime });
    engine.destroy();
  });

  it('does not select a command while runtime preparation is pending after query and back', async () => {
    const registry = createCommandRegistry<{ owner: string }, Runtime>({ shared: { owner: 'owner' }, runtimeRequired: true });
    const pending = deferred<Runtime>(), run = vi.fn();
    registry.registerMany([
      { id: 'alpha', label: 'Alpha', when: (_answers, context) => !!context.runtime.userId, run },
      { id: 'beta', label: 'Beta', when: (_answers, context) => !!context.runtime.userId, run },
    ]);
    const engine = createCommandEngine({ registry, runtime: () => pending.promise });
    expect(engine.getSnapshot().loading).toBe(true);
    engine.setQuery('beta');
    engine.back();
    engine.select(0);
    expect(run).not.toHaveBeenCalled();
    pending.resolve({ userId: 'alice' });
    await vi.waitFor(() => expect(engine.getSnapshot().loading).toBe(false));
    expect(engine.getSnapshot().command).toBeNull();
    expect(engine.getSnapshot().items.map(item => item.label)).toEqual(['Beta']);
    expect(run).not.toHaveBeenCalled();
    engine.destroy();
  });
});

describe('session and predicate regressions', () => {
  it('captures a new runtime for a new workflow after returning to the root', async () => {
    const registry = createCommandRegistry<{ owner: string }, Runtime>({ shared: { owner: 'owner' }, runtimeRequired: true });
    const provider = vi.fn().mockReturnValueOnce({ userId: 'alice' }).mockReturnValueOnce({ userId: 'bob' });
    const seen: string[] = [];
    registry.register({ id: 'publish', label: 'Publish', finalStep,
      when: (_answers, context) => { seen.push(context.runtime.userId); return true; }, run: () => {} });
    const engine = createCommandEngine({ registry, runtime: provider });
    await vi.waitFor(() => expect(engine.getSnapshot().items).toHaveLength(1));
    engine.select(0);
    engine.back();
    expect(provider).toHaveBeenCalledTimes(1);
    engine.select(0);
    await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(2));
    expect(seen).toContain('alice');
    expect(seen).toContain('bob');
    engine.destroy();
  });

  it('propagates the original exception from a historical predicate during construction', () => {
    const failure = new Error('legacy predicate failed');
    expect(() => createCommandEngine({ commands: [{ id: 'a', label: 'A', when: () => { throw failure; }, run: () => {} }] })).toThrow(failure);
  });

  it('evaluates a child predicate once when entering its menu', async () => {
    const registry = createCommandRegistry<{ owner: string }, Runtime>({ shared: { owner: 'owner' }, runtimeRequired: true });
    const when = vi.fn((_answers, context: { shared: { owner: string }; runtime: Runtime }) => !!context.runtime.userId);
    registry.register({ id: 'group', label: 'Group', commands: [{ id: 'child', label: 'Child', when, run: () => {} }] });
    const engine = createCommandEngine({ registry, runtime: () => ({ userId: 'alice' }) });
    await vi.waitFor(() => expect(engine.getSnapshot().items).toHaveLength(1));
    engine.select(0);
    expect(engine.getSnapshot().items.map(item => item.label)).toEqual(['Child']);
    expect(when).toHaveBeenCalledOnce();
    engine.destroy();
  });
});
