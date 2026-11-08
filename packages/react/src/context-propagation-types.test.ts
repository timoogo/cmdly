import { describe, expect, it } from 'vitest';
import { createCommandEngine, createCommandRegistry } from '@cmdly/core';
import type { CommandContext as PackageContext, ContextualStep as PackageStep } from '@cmdly/react';
import type { CommandContext as CoreContext, ContextualStep as CoreStep } from '@cmdly/core';

type Shared = { service: string };
type Runtime = { userId: string };

// These assignments check both package entry points and the contextual callback types.
const checkTypes = () => {
  const context: PackageContext<Shared, Runtime> = { shared: { service: 'posts' }, runtime: { userId: 'user' } };
  const coreContext: CoreContext<Shared, Runtime> = context;
  const step: PackageStep<Shared, Runtime> = {
    id: 'category', label: 'Category',
    when: (_, value) => value.shared.service === value.runtime.userId,
    options: (_, value) => [{ value: value.runtime.userId, label: value.shared.service }],
  };
  const coreStep: CoreStep<Shared, Runtime> = step;
  const registry = createCommandRegistry<Shared, Runtime>({ shared: context.shared, runtimeRequired: true });
  registry.register({
    id: 'group', label: 'Group', when: (_, value) => value.runtime.userId.length > 0,
    steps: [coreStep], commands: [{
      id: 'child', label: 'Child',
      finalStep: {
        when: (_, value) => value.shared.service === value.runtime.userId,
        render: (_, value) => value.shared.service + value.runtime.userId,
      },
      when: (_, value) => value.shared.service.length > 0,
      steps: [{ id: 'nested', label: 'Nested', options: async (_, value) => [{ value: value.runtime.userId, label: value.shared.service }] }],
      run: (_, value) => {
        // @ts-expect-error unknown shared property
        value.shared.missing;
        // @ts-expect-error unknown runtime property
        value.runtime.missing;
      },
    }],
  });
  const root = createCommandRegistry();
  root.mount('child', registry);
  const untypedEngine = createCommandEngine({ registry: root, runtime: () => context.runtime,
    callbacks: { onExecute(_command, _answers, value) {
      // @ts-expect-error runtime is unknown for an untyped root
      value?.runtime.userId;
    } },
    plugins: [{ setup(pluginEngine) {
      // @ts-expect-error plugin runtime is also unknown for an untyped root
      pluginEngine.getSnapshot().context?.runtime.userId;
    } }],
  });
  if (false) {
    // @ts-expect-error runtime must be narrowed for an untyped root
    untypedEngine.getSnapshot().context?.runtime.userId;
  }
  untypedEngine.destroy();
  const engine = createCommandEngine({ registry, runtime: () => context.runtime,
    callbacks: {
      onExecute(command, _answers, value) {
        value?.runtime.userId.toUpperCase();
        // @ts-expect-error registry views do not expose run
        command.run({});
        // @ts-expect-error mounted registries make shared unknown
        value?.shared.service;
      },
      onError(_error, _snapshot, value) { value?.runtime.userId.toUpperCase(); },
    },
    strategies: { closeOnComplete(_command, _answers, _final, value) { value?.runtime.userId.toUpperCase(); return false; } },
    plugins: [{ setup(pluginEngine) { pluginEngine.getSnapshot().context?.runtime.userId.toUpperCase(); } }],
  });
  engine.setOptions({ callbacks: { onExecute(_command, _answers, value) { value?.runtime.userId.toUpperCase(); } } });
  if (false) {
    const snapshot = engine.getSnapshot();
    // @ts-expect-error registry command predicates require a context
    snapshot.command?.when?.({});
    // @ts-expect-error registry final callbacks require a context
    snapshot.command?.finalStep;
    // @ts-expect-error registry step predicates require a context
    snapshot.command?.steps?.[0].when?.({});
    // @ts-expect-error registry options may require a context
    snapshot.command?.steps?.[0].options;
    // @ts-expect-error the selected registry step is also a view
    snapshot.step?.when?.({});
    // @ts-expect-error the selected registry step is also a view
    snapshot.step?.options;
    const legacy = createCommandEngine({ commands: [] }).getSnapshot();
    legacy.command?.when?.({});
    legacy.command?.steps?.[0].when?.({});
    legacy.step?.options;
    legacy.command?.finalStep;
  }
  engine.destroy();
  return coreContext;
};

describe('context propagation public types', () => {
  it('exposes contextual types from both entry points', () => {
    expect(checkTypes().runtime.userId).toBe('user');
  });
});
