import { describe, expect, it, vi } from 'vitest';
import { createCommandEngine, createCommandRegistry, CommandUnavailableError } from './index';
import type { ContextualCommand as PublicCommand, CommandRegistry as PublicRegistry } from 'cmdly';
import type { CommandRegistry as PublicCoreRegistry } from 'cmdly/core';
const publicTypes = (_command: PublicCommand<unknown, Runtime>, _registry: PublicRegistry<undefined, Runtime>, _core: PublicCoreRegistry<undefined, Runtime>) => {};
void publicTypes;

type Runtime = { userId: string };
const finalStep = { timing: 'before' as const, closeOnComplete: false };
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };

describe('registry execution context', () => {
  it('infers shared and checks runtime and public command context', () => {
    const registry = createCommandRegistry<{ service: { name: string } }, Runtime>({ runtimeRequired: true, shared: { service: { name: 'posts' } } });
    registry.register({ id: 'a', label: 'A', run: (_, { shared, runtime }) => {
      shared.service.name.toUpperCase(); runtime.userId.toUpperCase();
      // @ts-expect-error unknown shared property
      shared.missing;
      // @ts-expect-error unknown runtime property
      runtime.missing;
    } });
    registry.register({ id: 'nested', label: 'Nested', commands: [{ id: 'child', label: 'Child', run: (_, { shared, runtime }) => shared.service.name + runtime.userId }] });
    const engine = createCommandEngine({ registry, runtime: () => ({ userId: 'one' }) });
    if (false) {
      // @ts-expect-error runtime provider is required
      createCommandEngine({ registry });
      // @ts-expect-error wrong provider
      createCommandEngine({ registry, runtime: () => ({ bad: true }) });
      // @ts-expect-error excess runtime field
      engine.execute({ runtime: { userId: 'one', extra: true } });
      // @ts-expect-error contextual commands require a context
      registry.get('a')!.run!({});
      // @ts-expect-error contextual commands require a context
      registry.list()[0].run!({});
      // @ts-expect-error contextual commands require a context
      registry.resolve('a')!.command.run!({});
    }
    const inferred = createCommandRegistry({ shared: { value: 1 } });
    inferred.register({ id: 'a', label: 'A', run: (_, { shared }) => { shared.value.toFixed(); } });
    engine.destroy();
  });

  it('uses providers for automatic and manual executions and explicit values take priority', async () => {
    const registry = createCommandRegistry<{ label: string }, Runtime>({ runtimeRequired: true, shared: { label: 'owner' } });
    const run = vi.fn(); let count = 0;
    registry.register({ id: 'auto', label: 'Auto', run });
    registry.register({ id: 'manual', label: 'Manual', finalStep, run });
    const provider = vi.fn(() => ({ userId: String(++count) }));
    const automatic = createCommandEngine({ registry, runtime: provider }); automatic.select(0);
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    const manual = createCommandEngine({ registry, runtime: provider }); manual.select(1);
    await manual.execute(); await manual.execute({ runtime: { userId: 'explicit' } });
    expect(provider).toHaveBeenCalledTimes(2);
    expect(run.mock.calls.map(call => call[1])).toEqual([{ shared: { label: 'owner' }, runtime: { userId: '1' } }, { shared: { label: 'owner' }, runtime: { userId: '2' } }, { shared: { label: 'owner' }, runtime: { userId: 'explicit' } }]);
    automatic.destroy(); manual.destroy();
  });

  it('prevents a start while an asynchronous provider is pending after invalidation', async () => {
    const registry = createCommandRegistry<{ name: string }, Runtime>({ runtimeRequired: true, shared: { name: 'old' } });
    const run = vi.fn(), pending = deferred<Runtime>();
    const remove = registry.register({ id: 'a', label: 'A', finalStep, run });
    const engine = createCommandEngine({ registry, runtime: () => pending.promise }); engine.select(0);
    const execution = engine.execute(); expect(engine.getSnapshot().status).toBe('loading');
    remove(); registry.register({ id: 'a', label: 'New', finalStep, run }); pending.resolve({ userId: 'x' }); await execution;
    expect(run).not.toHaveBeenCalled(); expect(engine.getSnapshot().error).toBeInstanceOf(CommandUnavailableError);
    engine.destroy();
  });

  it('reports provider failures and prevents run', async () => {
    const registry = createCommandRegistry<{ name: string }, Runtime>({ runtimeRequired: true, shared: { name: 'x' } }); const run = vi.fn(), failure = new Error('provider');
    registry.register({ id: 'a', label: 'A', finalStep, run });
    const engine = createCommandEngine({ registry, runtime: async () => { throw failure; } }); engine.select(0); await engine.execute();
    expect(run).not.toHaveBeenCalled(); expect(engine.getSnapshot().error).toBe(failure); engine.destroy();
  });

  it('keeps the owner context and independent mount identities through nested commands', async () => {
    const root = createCommandRegistry<{ name: string }, Runtime>({ runtimeRequired: true, shared: { name: 'root' } });
    const child = createCommandRegistry<{ name: string }, Runtime>({ runtimeRequired: true, shared: { name: 'child' } });
    const run = vi.fn(); const source = { id: 'group', label: 'Group', commands: [{ id: 'nested', label: 'Nested', finalStep, run }] };
    child.register(source); const remove = root.mount('first', child); root.mount('second', child);
    const first = createCommandEngine({ registry: root, runtime: () => ({ userId: 'first' }) });
    const second = createCommandEngine({ registry: root, runtime: () => ({ userId: 'second' }) });
    first.select(0); first.select(0); second.select(1); second.select(0);
    remove(); root.mount('first', child); await first.execute(); await second.execute();
    expect(first.getSnapshot().error).toBeInstanceOf(CommandUnavailableError);
    expect(run).toHaveBeenCalledOnce(); expect(run.mock.calls[0][1]).toEqual({ shared: { name: 'child' }, runtime: { userId: 'second' } });
    expect(source.id).toBe('group'); expect(source.commands[0].id).toBe('nested'); first.destroy(); second.destroy();
  });


  it('rejects missing provider values before callbacks and business execution', async () => {
    const registry = createCommandRegistry<{ name: string }, Runtime>({ runtimeRequired: true, shared: { name: 'x' } });
    const run = vi.fn(), onExecute = vi.fn();
    registry.register({ id: 'a', label: 'A', finalStep, run });
    const engine = createCommandEngine({ registry, runtime: () => undefined as unknown as Runtime, callbacks: { onExecute } });
    engine.select(0); await engine.execute();
    expect(run).not.toHaveBeenCalled(); expect(onExecute).not.toHaveBeenCalled();
    expect(engine.getSnapshot().error).toEqual(new Error('Runtime is required')); engine.destroy();
  });

  it('retains captured values after run starts and registration changes', async () => {
    const shared = { name: 'old' }, registry = createCommandRegistry<typeof shared, Runtime>({ shared, runtimeRequired: true });
    const done = deferred<void>(), seen: string[] = [];
    const remove = registry.register({ id: 'a', label: 'A', finalStep, run: async (_, context) => { await done.promise; seen.push(context.shared.name + context.runtime.userId); } });
    const one = createCommandEngine({ registry, runtime: () => ({ userId: '1' }) }); const two = createCommandEngine({ registry, runtime: () => ({ userId: '2' }) });
    one.select(0); two.select(0); const a = one.execute(), b = two.execute(); remove(); done.resolve(); await Promise.all([a,b]);
    expect(seen).toEqual(['old1', 'old2']); one.destroy(); two.destroy();
  });
});
