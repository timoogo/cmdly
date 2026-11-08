import { createCommandEngine, type Command } from '@cmdly/core';

const hello: Command = { id: 'hello', label: 'Say hello', run: () => console.log('Hello!') };
const engine = createCommandEngine({ commands: [hello] });
engine.select(0);
// When finished: engine.destroy();
