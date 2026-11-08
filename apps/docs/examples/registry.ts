import { createCommandRegistry, createCommandEngine } from '@cmdly/core';

const root = createCommandRegistry();
const projects = createCommandRegistry();
const unregister = projects.register({ id: 'open', label: 'Open project', run: () => {} });
const unmount = root.mount('projects', projects);
const engine = createCommandEngine({ registry: root });
console.log(root.list().map(command => command.id)); // ["projects.open"]
// After a later register/unregister/mount/unmount: engine.refreshRegistry();
// When finished: unmount(); unregister(); engine.destroy();
