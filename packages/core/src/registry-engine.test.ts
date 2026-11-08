import { describe, expect, it, vi } from 'vitest';
import { CommandUnavailableError, createCommandEngine, createCommandRegistry } from '@cmdly/core';

const finalStep = { timing: 'before' as const, closeOnComplete: false };

describe('registry engine', () => {
  it('executes valid commands and refreshes the registry explicitly', async () => {
    const registry = createCommandRegistry(), run = vi.fn();
    const original = { id: 'a', label: 'A', run, finalStep };
    registry.register(original);
    const engine = createCommandEngine({ registry });
    registry.register({ id: 'b', label: 'B', run });
    expect(engine.getSnapshot().items).toHaveLength(1);
    engine.refreshRegistry();
    expect(engine.getSnapshot().items).toHaveLength(2);
    engine.select(0); await engine.execute();
    expect(run).toHaveBeenCalledTimes(1);
    expect(original.id).toBe('a');
    engine.destroy();
  });

  it('keeps the selected identity after unregister, reregister and refresh', async () => {
    const registry = createCommandRegistry(), oldRun = vi.fn(), newRun = vi.fn(), onError = vi.fn();
    const remove = registry.register({ id: 'a', label: 'A', run: oldRun, finalStep });
    const engine = createCommandEngine({ registry, callbacks: { onError } });
    engine.select(0); remove(); registry.register({ id: 'a', label: 'A', run: newRun, finalStep });
    engine.refreshRegistry(); await engine.execute();
    expect(oldRun).not.toHaveBeenCalled(); expect(newRun).not.toHaveBeenCalled();
    expect(engine.getSnapshot().error).toBeInstanceOf(CommandUnavailableError);
    expect(onError).toHaveBeenCalledOnce();
    engine.back(); engine.select(0); await engine.execute();
    expect(newRun).toHaveBeenCalledOnce();
    engine.destroy();
  });

  it('tracks mount identities independently, including remounting', async () => {
    const child = createCommandRegistry(), root = createCommandRegistry(), run = vi.fn();
    child.register({ id: 'a', label: 'A', run, finalStep });
    const unmount = root.mount('first', child); root.mount('second', child);
    const first = createCommandEngine({ registry: root }), second = createCommandEngine({ registry: root });
    first.select(0); second.select(1); unmount(); root.mount('first', child);
    await first.execute(); await second.execute();
    expect(first.getSnapshot().error).toBeInstanceOf(CommandUnavailableError);
    expect(run).toHaveBeenCalledOnce();
    first.destroy(); second.destroy();
  });

  it('keeps root provenance through nested multi-step navigation and refresh', async () => {
    const registry = createCommandRegistry(), run = vi.fn();
    const remove = registry.register({ id: 'manage', label: 'Manage', commands: [{ id: 'archive', label: 'Archive', run, steps: [{ id: 'x', label: 'X', options: [{ value: 'y', label: 'Y' }] }] }] });
    const engine = createCommandEngine({ registry });
    engine.select(0); engine.select(0);
    expect(engine.getSnapshot().phase).toBe('step');
    remove(); registry.register({ id: 'manage', label: 'New', run });
    engine.refreshRegistry(); engine.select(0);
    await vi.waitFor(() => expect(engine.getSnapshot().error).toBeInstanceOf(CommandUnavailableError));
    expect(run).not.toHaveBeenCalled(); engine.destroy();
  });

  it('allows concurrent started invocations to finish after invalidation', async () => {
    const registry = createCommandRegistry();
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const run = vi.fn(() => pending);
    const remove = registry.register({ id: 'a', label: 'A', run, finalStep });
    const one = createCommandEngine({ registry }), two = createCommandEngine({ registry }), later = createCommandEngine({ registry });
    one.select(0); two.select(0); later.select(0);
    const p1 = one.execute(), p2 = two.execute();
    expect(run).toHaveBeenCalledTimes(2);
    remove(); registry.register({ id: 'a', label: 'New', run, finalStep });
    await later.execute();
    expect(later.getSnapshot().error).toBeInstanceOf(CommandUnavailableError);
    finish(); await Promise.all([p1, p2]);
    expect(one.getSnapshot().status).toBe('success'); expect(two.getSnapshot().status).toBe('success');
    expect(run).toHaveBeenCalledTimes(2);
    one.destroy(); two.destroy(); later.destroy();
  });

  it('rejects external commands atomically while retaining active provenance', async () => {
    const registry = createCommandRegistry(), run = vi.fn(), injected = vi.fn();
    const remove = registry.register({ id: 'a', label: 'A', run, finalStep });
    const engine = createCommandEngine({ registry }); engine.select(0);
    const before = engine.getSnapshot(), listener = vi.fn(); engine.subscribe(listener);
    const replacement = [{ id: 'a', label: 'New', run: injected }];
    expect(() => engine.setCommands(replacement)).toThrow('Cannot set commands on a registry engine');
    expect(() => engine.setOptions({ commands: replacement, defaults: { arrowNavigation: true } })).toThrow('Cannot set commands on a registry engine');
    expect(engine.getSnapshot()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
    remove(); await engine.execute();
    expect(engine.getSnapshot().error).toBeInstanceOf(CommandUnavailableError);
    expect(run).not.toHaveBeenCalled(); expect(injected).not.toHaveBeenCalled();
    engine.destroy();
  });

  it('does not subscribe to the registry and rejects ambiguous inputs', () => {
    const registry = createCommandRegistry(), subscribe = vi.spyOn(registry, 'subscribe');
    const engine = createCommandEngine({ registry }); engine.destroy(); engine.refreshRegistry();
    expect(subscribe).not.toHaveBeenCalled();
    expect(() => createCommandEngine({ registry, commands: [] } as never)).toThrow();
  });
});

it('rechecks provenance after onExecute and through back navigation', async () => {
  const registry = createCommandRegistry(), run = vi.fn();
  const remove = registry.register({ id: 'a', label: 'A', run, finalStep, steps: [
    { id: 'first', label: 'First', options: [{ value: 'one', label: 'One' }] },
    { id: 'second', label: 'Second', options: [{ value: 'two', label: 'Two' }] },
  ] });
  const engine = createCommandEngine({ registry, callbacks: { onExecute: remove } });
  engine.select(0); engine.select(0); engine.back(); engine.forward(); engine.select(0);
  expect(engine.getSnapshot().phase).toBe('final');
  await engine.execute();
  expect(run).not.toHaveBeenCalled();
  expect(engine.getSnapshot().error).toBeInstanceOf(CommandUnavailableError);
  engine.destroy();
});

it('rejects invalidation by a listener during the execution publication', async () => {
  const registry = createCommandRegistry(), run = vi.fn(), onExecute = vi.fn();
  const remove = registry.register({ id: 'a', label: 'A', run, finalStep });
  const engine = createCommandEngine({ registry, callbacks: { onExecute } });
  engine.select(0);
  engine.subscribe(() => { if (engine.getSnapshot().status === 'loading') remove(); });
  await engine.execute();
  expect(run).not.toHaveBeenCalled(); expect(onExecute).not.toHaveBeenCalled();
  expect(engine.getSnapshot().error).toBeInstanceOf(CommandUnavailableError);
  engine.destroy();
});

it('reports a throwing onExecute without calling run', async () => {
  const registry = createCommandRegistry(), run = vi.fn(), failure = new Error('callback failed');
  registry.register({ id: 'a', label: 'A', run, finalStep });
  const engine = createCommandEngine({ registry, callbacks: { onExecute: () => { throw failure; } } });
  engine.select(0); await engine.execute();
  expect(engine.getSnapshot().error).toBe(failure); expect(run).not.toHaveBeenCalled();
  engine.destroy();
});

it('retains nested provenance after back, forward, remount, replacement and refresh', async () => {
  const root = createCommandRegistry(), child = createCommandRegistry(), run = vi.fn();
  const define = () => child.register({ id: 'manage', label: 'Manage', commands: [{ id: 'archive', label: 'Archive', run, finalStep, steps: [
    { id: 'x', label: 'X', options: [{ value: 'x', label: 'X' }] },
    { id: 'y', label: 'Y', options: [{ value: 'y', label: 'Y' }] },
  ] }] });
  const remove = define(), unmount = root.mount('posts', child);
  const engine = createCommandEngine({ registry: root });
  engine.select(0); engine.select(0); engine.select(0);
  expect(engine.getSnapshot().step?.id).toBe('y');
  engine.back(); expect(engine.getSnapshot().step?.id).toBe('x');
  unmount(); remove(); define(); root.mount('posts', child); engine.refreshRegistry();
  engine.forward(); expect(engine.getSnapshot().step?.id).toBe('y');
  engine.select(0); expect(engine.getSnapshot().phase).toBe('final');
  await engine.execute(); expect(run).not.toHaveBeenCalled();
  expect(engine.getSnapshot().error).toBeInstanceOf(CommandUnavailableError);
  engine.destroy();
});

it('keeps a started run through refresh and ignores its result after destroy', async () => {
  const registry = createCommandRegistry();
  let finish!: (value: string) => void;
  const run = vi.fn(() => new Promise<string>(resolve => { finish = resolve; }));
  const remove = registry.register({ id: 'a', label: 'A', run, finalStep });
  const engine = createCommandEngine({ registry }); engine.select(0);
  const execution = engine.execute(); expect(run).toHaveBeenCalledOnce();
  remove(); registry.register({ id: 'a', label: 'New', run: () => {}, finalStep });
  engine.refreshRegistry();
  expect(engine.getSnapshot().status).toBe('loading');
  engine.destroy(); const snapshot = engine.getSnapshot();
  finish('done'); await execution;
  expect(engine.getSnapshot()).toBe(snapshot);
});

it('does not replace the menu when a registry refresh fails', () => {
  const registry = createCommandRegistry();
  registry.register({ id: 'a', label: 'A', run: () => {} });
  const engine = createCommandEngine({ registry }), before = engine.getSnapshot();
  registry.register({ id: 'b', label: 'B', run: () => {} });
  const resolve = vi.spyOn(registry, 'resolve').mockImplementation(() => undefined);
  expect(() => engine.refreshRegistry()).toThrow('Registry changed while reading');
  expect(engine.getSnapshot()).toBe(before);
  resolve.mockRestore(); engine.refreshRegistry();
  expect(engine.getSnapshot().items).toHaveLength(2);
  engine.destroy();
});
