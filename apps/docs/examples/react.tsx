import { useEffect, useState } from 'react';
import { createCommandEngine, type CommandEngine } from '@cmdly/core';
import { useCommandEngine } from '@cmdly/react';

function Menu({ engine, onRestart }: { engine: CommandEngine; onRestart: () => void }) {
  const { state, actions } = useCommandEngine(engine);
  if (state.closed) return <button onClick={onRestart}>Start again</button>;
  return <div><p>{state.menuLabel}</p>{state.items.map((item, index) =>
    <button key={index} onClick={() => actions.select(index)}>{item.label}</button>
  )}<button onClick={actions.back} disabled={!state.canBack}>Back</button></div>;
}
export function Example() {
  const [engine, setEngine] = useState<CommandEngine | null>(null);
  const [session, setSession] = useState(0);
  useEffect(() => {
    const instance = createCommandEngine({ commands: [
      { id: 'hello', label: 'Say hello', run: () => console.log('Hello!') },
    ] });
    setEngine(instance);
    return () => instance.destroy();
  }, [session]);
  return engine ? <Menu engine={engine} onRestart={() => setSession(value => value + 1)} /> : <p>Loading commands…</p>;
}
