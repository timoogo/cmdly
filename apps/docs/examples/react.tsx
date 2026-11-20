import { useEffect, useState } from 'react';
import { createCommandEngine, type CommandEngine } from '@cmdly/core';
import { useCommandEngine } from '@cmdly/react';

function Search({ engine }: { engine: CommandEngine }) {
  const { state, actions } = useCommandEngine(engine);
  return <label>
    Search <input value={state.query} onChange={event => actions.setQuery(event.target.value)} />
    <output>{state.items.length} matching</output>
  </label>;
}
export function Example() {
  const [engine, setEngine] = useState<CommandEngine | null>(null);
  useEffect(() => {
    const instance = createCommandEngine({ commands: [
      { id: 'hello', label: 'Say hello', run: () => console.log('Hello!') },
      { id: 'bye', label: 'Say goodbye', run: () => console.log('Goodbye!') },
    ] });
    setEngine(instance);
    return () => instance.destroy();
  }, []);
  return engine && <Search engine={engine} />;
}
