import { createCommandEngine, type Command } from '@cmdly/core';

const deploy: Command = {
  id: 'deploy', label: 'Deploy',
  steps: [
    { id: 'environment', label: 'Environment', options: [
      { value: 'staging', label: 'Staging' }, { value: 'production', label: 'Production' },
    ] },
    { id: 'region', label: 'Region', when: answers => answers.environment === 'production',
      options: [{ value: 'eu', label: 'Europe' }, { value: 'us', label: 'United States' }] },
  ],
  run: answers => console.log(answers),
};
const engine = createCommandEngine({ commands: [deploy] });
engine.select(0); // enter the workflow
// Inspect engine.getSnapshot().items; select an option by its displayed index.
