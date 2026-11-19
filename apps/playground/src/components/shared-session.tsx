import { useEffect, useState } from 'react';
import { CommandPalette, createCommandEngine, useCommandCombobox, useCommandEngine, type Command, type CommandEngine } from '@cmdly/react';
import { CompactContent } from './custom-bubble';

const wait = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); });
});

function sharedCommands(log: (text: string) => void): Command[] {
  return [
    { id: 'shared-deploy', label: 'Deploy service', steps: [{ id: 'env', label: 'Environment', options: [{ value: 'staging', label: 'Staging' }, { value: 'production', label: 'Production' }] }], run: answers => log(`Deployed to ${answers.env}`) },
    { id: 'shared-sync', label: 'Long sync (3 s)', finalStep: { timing: 'after', closeOnComplete: false }, run: async (_answers, context) => { await wait(3000, context?.signal); log('Sync finished'); } },
  ];
}

/** One external session, shown in turn by the historical palette and by a headless inline panel. */
export function SharedSession() {
  const [engine, setEngine] = useState<CommandEngine | null>(null);
  const [generation, setGeneration] = useState(0);
  const [view, setView] = useState<'palette' | 'panel' | null>(null);
  const [log, setLog] = useState<string[]>([]);
  useEffect(() => {
    // Created in an effect and destroyed by its cleanup: StrictMode replays get a fresh engine.
    const instance = createCommandEngine({ commands: sharedCommands(text => setLog(items => [text, ...items])), tokens: { types: [] } });
    setEngine(instance);
    return () => instance.destroy();
  }, [generation]);
  if (!engine) return null;
  return <Shared engine={engine} view={view} setView={setView} log={log} onRestart={() => { setView(null); setGeneration(value => value + 1); }} />;
}

function Shared({ engine, view, setView, log, onRestart }: { engine: CommandEngine; view: 'palette' | 'panel' | null; setView: (view: 'palette' | 'panel' | null) => void; log: string[]; onRestart: () => void }) {
  const { state } = useCommandEngine(engine);
  return <div className="shared">
    <h2>Shared session</h2>
    <p>One engine you own, shown by the palette or by an inline headless panel. Hiding either keeps the query, the step and a running command.</p>
    <div className="shared-actions">
      <button onClick={() => setView('palette')}>Open shared session in palette</button>
      <button onClick={() => setView('panel')}>Show shared session inline</button>
    </div>
    <SessionStatus engine={engine} onRestart={onRestart} />
    <CommandPalette engine={engine} open={view === 'palette'} onOpenChange={open => setView(open ? 'palette' : null)} label="Shared session" />
    {/* A headless view follows a closed engine itself; the palette does it for you. */}
    {view === 'panel' && !state.closed && <Panel engine={engine} onDismiss={() => setView(null)} />}
    <div className="shared-log" aria-live="polite">{log.map((text, index) => <p key={index}>{text}</p>)}</div>
  </div>;
}

function SessionStatus({ engine, onRestart }: { engine: CommandEngine; onRestart: () => void }) {
  const { state } = useCommandEngine(engine);
  const where = state.step?.label ?? (state.phase === 'final' ? 'final step' : 'menu');
  return <p className="shared-status" data-testid="shared-status">
    {state.closed ? 'closed' : `${where}${state.query ? ` · “${state.query}”` : ''}${state.running ? ' · running' : ''}`}
    {state.closed && <button onClick={onRestart}>New session</button>}
  </p>;
}

function Panel({ engine, onDismiss }: { engine: CommandEngine; onDismiss: () => void }) {
  const command = useCommandCombobox(engine, { onDismiss });
  return <section className="shared-panel" aria-label="Shared session" {...command.rootProps}>
    {command.tokens.announcer && <span {...command.tokens.announcer} />}
    <CompactContent command={command} />
  </section>;
}
