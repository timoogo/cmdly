import { describe, expect, it, vi } from 'vitest';
import { createCommandEngine, createCommandRegistry } from '@cmdly/core';
import { useCommandEngine } from '@cmdly/react';
import type { CommandRegistry, RegistryCommandEngine, RequiredRuntime } from '@cmdly/core';
import type { CommandRegistry as MainRegistry } from '@cmdly/react';
import type { CommandRegistry as CoreRegistry } from '@cmdly/core';

type Runtime = { userId: string };
type Shared = { name: string };

function genericExecute<R>(engine: RegistryCommandEngine<R, true>, runtime: RequiredRuntime<R>) {
  return engine.execute({ runtime });
}
function genericFactory<R extends object>(runtime: () => R) {
  const registry = createCommandRegistry<Shared, R>({ shared: { name: 'generic' }, runtimeRequired: true });
  return createCommandEngine({ registry, runtime });
}
void genericExecute;
void genericFactory;

describe('runtime requirement type contract', () => {
  it('rejects an undefined value resolved from an unknown runtime at execution', async () => {
    const registry = createCommandRegistry({ shared: { name: 'owner' }, runtimeRequired: true });
    const run = vi.fn();
    registry.register({ id: 'a', label: 'A', finalStep: { timing: 'before' }, run });
    const engine = createCommandEngine({ registry, runtime: () => Promise.resolve(undefined) });
    engine.select(0);
    await engine.execute();
    expect(run).not.toHaveBeenCalled();
    expect(engine.getSnapshot().error).toEqual(new Error('Runtime is required'));
    engine.destroy();
  });

  it('checks a dynamically mounted owner requirement even when the root type is optional', () => {
    const root = createCommandRegistry();
    const child = createCommandRegistry({ shared: { name: 'child' }, runtimeRequired: true });
    const when = vi.fn(() => true), run = vi.fn();
    child.register({ id: 'a', label: 'A', when, run });
    root.mount('child', child);
    const engine = createCommandEngine({ registry: root });
    expect(engine.getSnapshot().error).toEqual(new Error('Runtime is required'));
    expect(when).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    engine.destroy();
  });

  it('passes a provider value to a runtime-free mounted registry whose runtime type is undefined', async () => {
    const root = createCommandRegistry();
    const child = createCommandRegistry({ shared: { child: true } });
    const run = vi.fn();
    child.register({ id: 'a', label: 'A', run: (_answers, context) => { const declared: undefined = context.runtime; void declared; run(context); } });
    root.mount('child', child);
    const runtime = { userId: 'one' };
    const engine = createCommandEngine({ registry: root, runtime: () => runtime });
    engine.select(0);
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    expect(run.mock.calls[0][0].runtime).toBe(runtime);
    engine.destroy();
  });

  it('retains the literal requirement independently from the runtime type', () => {
    const typed = createCommandRegistry<Shared, Runtime>({ shared: { name: 'typed' }, runtimeRequired: true });
    const inferred = createCommandRegistry({ shared: { name: 'unknown' }, runtimeRequired: true });
    const explicitUnknown = createCommandRegistry<Shared, unknown>({ shared: { name: 'unknown' }, runtimeRequired: true });
    const optional = createCommandRegistry<Shared, Runtime | undefined>({ shared: { name: 'optional' } });
    const noRuntime = createCommandRegistry();
    const optionalUnknown = createCommandRegistry<Shared, unknown>({ shared: { name: 'optional-unknown' } });
    const dynamicOptions: { shared: Shared; runtimeRequired?: boolean } = { shared: { name: 'dynamic' } };
    const dynamic = createCommandRegistry(dynamicOptions);
    const widened: CommandRegistry<Shared, unknown> = inferred;
    const mainExport: MainRegistry<Shared, unknown, true> = inferred;
    const coreExport: CoreRegistry<Shared, unknown, true> = inferred;
    void mainExport; void coreExport;

    expect([typed.runtimeRequired, inferred.runtimeRequired, optional.runtimeRequired, noRuntime.runtimeRequired]).toEqual([true, true, false, false]);
    if (false) {
      // @ts-expect-error required typed runtime needs a provider before navigation
      createCommandEngine({ registry: typed });
      // @ts-expect-error inferred unknown is still required
      createCommandEngine({ registry: inferred });
      // @ts-expect-error explicitly unknown is still required
      createCommandEngine({ registry: explicitUnknown });
      // @ts-expect-error a dynamic requirement must be treated conservatively
      createCommandEngine({ registry: dynamic });
      // @ts-expect-error widened requirement must be treated conservatively
      createCommandEngine({ registry: widened });
      // @ts-expect-error execute cannot replace the required construction-time provider
      createCommandEngine({ registry: inferred }).execute({ runtime: { userId: 'one' } });
      // @ts-expect-error wrong typed runtime provider
      createCommandEngine({ registry: typed, runtime: () => ({ wrong: true }) });
      const typedEngine = createCommandEngine({ registry: typed, runtime: () => ({ userId: 'one' }) });
      typedEngine.execute({ runtime: { userId: 'two' } });
      const extendedRuntime = { userId: 'two', extra: true };
      typedEngine.execute({ runtime: extendedRuntime });
      // @ts-expect-error explicit runtime must match the declared type
      typedEngine.execute({ runtime: { wrong: true } });
      const requiredUnknownEngine = createCommandEngine({ registry: inferred, runtime: () => ({ userId: 'one' }) });
      requiredUnknownEngine.execute({ runtime: 42 });
      requiredUnknownEngine.execute({ runtime: null });
      // @ts-expect-error required unknown does not include undefined
      createCommandEngine({ registry: inferred, runtime: () => undefined });
      // @ts-expect-error explicit undefined cannot satisfy a required runtime
      requiredUnknownEngine.execute({ runtime: undefined });
      const requiredOptional = createCommandRegistry<Shared, Runtime | undefined>({ shared: { name: 'required' }, runtimeRequired: true });
      // @ts-expect-error a required provider may not return undefined
      createCommandEngine({ registry: requiredOptional, runtime: () => undefined });
      // @ts-expect-error required undefined can never be supplied
      createCommandRegistry<Shared, undefined>({ shared: { name: 'impossible' }, runtimeRequired: true });
      // @ts-expect-error runtime types are invariant; narrowing would be unsound
      const narrow: CommandRegistry<Shared, Runtime, false> = optional;
      void narrow;
      dynamic.register({ id: 'dynamic', label: 'Dynamic', run: (_answers, context) => {
        const value: unknown = context.runtime;
        void value;
        // @ts-expect-error a dynamic runtime is not known to be undefined
        const missing: undefined = context.runtime;
        void missing;
      } });
      const optionalEngine = createCommandEngine({ registry: optional, runtime: () => undefined });
      useCommandEngine(optionalEngine).actions.execute({ runtime: undefined });
      // @ts-expect-error the React hook retains a required runtime's exclusion of undefined
      useCommandEngine(requiredUnknownEngine).actions.execute({ runtime: undefined });
      createCommandEngine({ registry: explicitUnknown, runtime: async () => 'value' });
      createCommandEngine({ registry: optional });
      createCommandEngine({ registry: optionalUnknown });
      createCommandEngine({ registry: noRuntime });
      createCommandEngine({ commands: [{ id: 'legacy', label: 'Legacy', run: answers => answers }] });
      const parent = createCommandRegistry<{ parent: boolean }, Runtime>({ shared: { parent: true }, runtimeRequired: true });
      const child = createCommandRegistry<{ child: number }, Runtime>({ shared: { child: 1 }, runtimeRequired: true });
      parent.mount('child', child);
      createCommandEngine({ registry: parent, runtime: () => ({ userId: 'one' }) });
    }
  });
});
