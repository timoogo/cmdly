import { describe, expect, it, vi } from 'vitest';
import { createCommandEngine, createCommandRegistry, CommandUnavailableError, type Command, type CommandView, type EngineSnapshot, type RegistryCommandEngine } from '@cmdly/core';
import type { CommandView as PackageView } from '@cmdly/react';
import type { CommandView as CoreView } from '@cmdly/core';

const finalStep = { timing: 'before' as const, closeOnComplete: false };
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };

describe('public registry safety', () => {
  it('rejects an absent required runtime even when engine types are bypassed', async () => {
    const registry = createCommandRegistry<{ name: string }, string>({ shared: { name: 'posts' }, runtimeRequired: true });
    const run = vi.fn(), onExecute = vi.fn(), onError = vi.fn();
    registry.register({ id: 'a', label: 'A', run, finalStep });
    const engine = createCommandEngine({ registry, callbacks: { onExecute, onError } } as never) as RegistryCommandEngine<string>;
    engine.select(0); await engine.execute();
    expect(run).not.toHaveBeenCalled(); expect(onExecute).not.toHaveBeenCalled();
    expect(engine.getSnapshot().error).toEqual(new Error('Runtime is required')); expect(onError).toHaveBeenCalledOnce();
    engine.destroy();
  });

  it.each([false, 0, ''])('accepts a required runtime with falsy value %s', async value => {
    const registry = createCommandRegistry<{ name: string }, boolean | number | string>({ shared: { name: 'x' }, runtimeRequired: true });
    const run = vi.fn(), provider = vi.fn(() => value); registry.register({ id: 'a', label: 'A', run, finalStep });
    const engine = createCommandEngine({ registry, runtime: provider }); engine.select(0); await engine.execute();
    expect(run.mock.calls[0][1].runtime).toBe(value); expect(provider).toHaveBeenCalledOnce(); engine.destroy();
  });

  it('supports different owner policies and preserves nested provenance across remounts', async () => {
    const root = createCommandRegistry();
    const required = createCommandRegistry<{ name: string }, string>({ shared: { name: 'required' }, runtimeRequired: true });
    const optional = createCommandRegistry<{ name: string }, string | undefined>({ shared: { name: 'optional' }, runtimeRequired: false });
    const rootRun = vi.fn(), requiredRun = vi.fn(), optionalRun = vi.fn();
    root.register({ id: 'root', label: 'Root', run: rootRun, finalStep });
    required.register({ id: 'group', label: 'Group', commands: [{ id: 'nested', label: 'Nested', run: requiredRun, finalStep }] });
    optional.register({ id: 'a', label: 'Optional', run: optionalRun, finalStep });
    const unmount = root.mount('required', required); root.mount('optional', optional);
    const one = createCommandEngine({ registry: root }), two = createCommandEngine({ registry: root }), three = createCommandEngine({ registry: root });
    one.select(0); await one.execute(); expect(rootRun).toHaveBeenCalledOnce();
    two.select(1); two.select(0); await two.execute(); expect(requiredRun).not.toHaveBeenCalled(); expect(two.getSnapshot().error).toEqual(new Error('Runtime is required'));
    three.select(2); await three.execute(); expect(optionalRun).toHaveBeenCalledOnce(); expect(optionalRun.mock.calls[0][1].runtime).toBeUndefined();
    unmount(); root.mount('required', required); await two.execute({ runtime: 'value' });
    expect(two.getSnapshot().error).toBeInstanceOf(CommandUnavailableError); expect(requiredRun).not.toHaveBeenCalled();
    one.destroy(); two.destroy(); three.destroy();
  });

  it('rechecks a required mounted registration after an asynchronous provider resolves', async () => {
    const root = createCommandRegistry(), child = createCommandRegistry<{ name: string }, string>({ shared: { name: 'old' }, runtimeRequired: true });
    const run = vi.fn(), pending = deferred<string>(); const remove = child.register({ id: 'a', label: 'A', run, finalStep }); root.mount('child', child);
    const provider = vi.fn(() => pending.promise), engine = createCommandEngine({ registry: root, runtime: provider }); engine.select(0);
    const execution = engine.execute(); remove(); child.register({ id: 'a', label: 'New', run, finalStep }); pending.resolve('x'); await execution;
    expect(provider).toHaveBeenCalledOnce(); expect(run).not.toHaveBeenCalled(); expect(engine.getSnapshot().error).toBeInstanceOf(CommandUnavailableError); engine.destroy();
  });

  it('exposes only views through registry snapshots, callbacks, strategies, options and plugins', () => {
    const registry = createCommandRegistry<{ name: string }, string>({ shared: { name: 'x' }, runtimeRequired: true });
    // @ts-expect-error a required runtime type needs an explicit runtime policy
    createCommandRegistry<{ name: string }, string>({ shared: { name: 'x' } });
    const inferred = createCommandRegistry({ shared: { name: 'x' }, runtimeRequired: true });
    inferred.register({ id: 'inferred', label: 'Inferred', run: (_, { runtime }) => {
      // @ts-expect-error runtime must be narrowed when its type is inferred as unknown
      runtime.userId;
    } });
    const engine = createCommandEngine({ registry, runtime: () => 'x', callbacks: {
      onExecute(command) { command.label; 
        // @ts-expect-error contextual commands do not expose run
        command.run({}); },
      onNavigate(snapshot) { 
        // @ts-expect-error contextual commands do not expose run
        snapshot.command?.run({}); },
      onError(_error, snapshot) { 
        // @ts-expect-error contextual commands do not expose run
        snapshot.command?.run({}); },
      onClose(snapshot) { 
        // @ts-expect-error contextual commands do not expose run
        snapshot.command?.run({}); },
    }, strategies: {
      allowTransition(snapshot) { 
        // @ts-expect-error contextual commands do not expose run
        snapshot.command?.run({}); return true; },
      closeOnComplete(command) { 
        // @ts-expect-error contextual commands do not expose run
        command.run({}); return false; },
    }, plugins: [{ setup(pluginEngine) { 
        // @ts-expect-error contextual commands do not expose run
        pluginEngine.getSnapshot().command?.run({}); } }] });
    const snapshot: EngineSnapshot<CommandView> = engine.getSnapshot();
    const view: PackageView | CoreView | null = snapshot.command; void view;
    // @ts-expect-error contextual commands in snapshots have no exposed run
    engine.getSnapshot().command?.run({});
    const item = engine.getSnapshot().items[0];
    if (item && 'id' in item) {
      // @ts-expect-error menu commands are views
      item.run({});
    }
    engine.setOptions({ callbacks: { onExecute(command) {
      // @ts-expect-error callbacks updated later also receive views
      command.run({});
    } } });
    const legacy = createCommandEngine({ commands: [{ id: 'a', label: 'A', run: () => {} }] });
    const old: Command | null = legacy.getSnapshot().command; old?.run?.({});
    engine.destroy(); legacy.destroy();
  });
});
