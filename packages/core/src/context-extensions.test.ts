import { describe, expect, it, vi } from 'vitest';
import { createCommandEngine, createCommandRegistry } from '@cmdly/core';

type Runtime = { userId: string };

describe('contextual workflow extensions', () => {
  it.each(['before', 'after'] as const)('passes mounted owner context to final predicate, callbacks and strategy (%s)', async timing => {
    const shared = { owner: 'child' }, runtime = { userId: 'alice' };
    const root = createCommandRegistry<{ owner: string }, Runtime>({ shared: { owner: 'root' }, runtimeRequired: true });
    const child = createCommandRegistry<typeof shared, Runtime>({ shared, runtimeRequired: true });
    const finalWhen = vi.fn((_answers, context: { shared: typeof shared; runtime: Runtime }) => context.runtime.userId === 'alice');
    const run = vi.fn(), onExecute = vi.fn(), onNavigate = vi.fn(), closeOnComplete = vi.fn((..._args: unknown[]) => false);
    child.register({ id: 'publish', label: 'Publish', finalStep: { timing, when: finalWhen, closeOnComplete: false }, run });
    root.mount('child', child);
    const engine = createCommandEngine({ registry: root, runtime: () => runtime, callbacks: { onExecute, onNavigate }, strategies: { closeOnComplete } });
    await vi.waitFor(() => expect(engine.getSnapshot().items).toHaveLength(1));
    engine.select(0);
    if (timing === 'before') await engine.execute();
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(closeOnComplete).toHaveBeenCalledOnce());
    expect(finalWhen).toHaveBeenCalled();
    expect(finalWhen.mock.calls.every(call => call[1].shared === shared && call[1].runtime === runtime)).toBe(true);
    expect(onExecute.mock.calls[0][2]).toEqual({ shared, runtime });
    expect(closeOnComplete.mock.calls[0][3]).toEqual({ shared, runtime });
    expect(onNavigate.mock.calls.some(call => call[1]?.shared === shared && call[1]?.runtime === runtime)).toBe(true);
    expect(run).toHaveBeenCalledOnce();
    engine.destroy();
  });

  it('reports execution failure with its invocation context', async () => {
    const shared = { owner: 'owner' }, runtime = { userId: 'alice' }, failure = new Error('run failed');
    const registry = createCommandRegistry<typeof shared, Runtime>({ shared, runtimeRequired: true });
    const onError = vi.fn();
    registry.register({ id: 'publish', label: 'Publish', finalStep: { timing: 'before', closeOnComplete: false }, run: () => { throw failure; } });
    const engine = createCommandEngine({ registry, runtime: () => runtime, callbacks: { onError } });
    await vi.waitFor(() => expect(engine.getSnapshot().items).toHaveLength(1));
    engine.select(0); await engine.execute();
    expect(engine.getSnapshot().error).toBe(failure);
    expect(onError.mock.calls[0][0]).toBe(failure);
    expect(onError.mock.calls[0][2]).toEqual({ shared, runtime });
    engine.destroy();
  });

  it('does not run if contextual onExecute invalidates the mounted registration', async () => {
    const shared = { owner: 'child' }, runtime = { userId: 'alice' };
    const root = createCommandRegistry<{ owner: string }, Runtime>({ shared: { owner: 'root' }, runtimeRequired: true });
    const child = createCommandRegistry<typeof shared, Runtime>({ shared, runtimeRequired: true });
    const run = vi.fn();
    child.register({ id: 'publish', label: 'Publish', finalStep: { timing: 'before', closeOnComplete: false }, run });
    const unmount = root.mount('child', child);
    const onExecute = vi.fn((..._args: unknown[]) => unmount());
    const engine = createCommandEngine({ registry: root, runtime: () => runtime, callbacks: { onExecute } });
    await vi.waitFor(() => expect(engine.getSnapshot().items).toHaveLength(1));
    engine.select(0); await engine.execute();
    expect(onExecute.mock.calls[0][2]).toEqual({ shared, runtime });
    expect(run).not.toHaveBeenCalled();
    expect(engine.getSnapshot().error).toBeTruthy();
    engine.destroy();
  });
});
