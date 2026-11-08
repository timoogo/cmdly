import { createCommandEngine, createCommandRegistry } from '@cmdly/core';

type Shared = { workspace: string };
type Runtime = { userId: string };
const registry = createCommandRegistry<Shared, Runtime>({
  shared: { workspace: 'Design' }, runtimeRequired: true,
});
registry.register({
  id: 'publish', label: 'Publish',
  run: (_answers, { shared, runtime }) => console.log(shared.workspace, runtime.userId),
});
const engine = createCommandEngine({ registry, runtime: () => ({ userId: 'user-1' }) });
engine.select(0);
