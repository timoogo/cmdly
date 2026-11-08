import { useEffect, useMemo, useState } from 'react';
import { CommandPalette } from '@cmdly/react';
import type { EnginePlugin, EngineStrategies } from '@cmdly/core';
import { createCommands, type Activity } from './commands';
import { Progress } from './components/progress';
import './style.css';

// Optional extensions: these objects are stable across React renders.
const strategies: EngineStrategies = {
  closeOnComplete: (command, _answers, finalStep) => command.id === 'create' ? false : !finalStep || (finalStep.closeOnComplete ?? finalStep.timing === 'before'),
};
const plugins: EnginePlugin[] = [{ setup(engine) {
  const unsubscribe = engine.subscribe(() => {
    if (engine.getSnapshot().status === 'success') console.info('Cmdly workflow completed');
  });
  return unsubscribe;
} }];

export default function App() {
  const [open, setOpen] = useState(false);
  const [failLoading, setFailLoading] = useState(false);
  const [activity, setActivity] = useState<Activity[]>([]);
  const commands = useMemo(() => createCommands((entry) => setActivity((items) => [entry, ...items]), failLoading), [failLoading]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <main className="app">
      <header><span className="brand">cmdly <span> / playground</span></span><span className="badge">Interactive demo</span></header>
      <section className="hero">
        <p className="eyebrow">A LITTLE LESS CLICKING</p>
        <h1>Everything you need,<br /><em>one command away.</em></h1>
        <p className="intro">Explore commands and guided workflows in a small, real-world playground.</p>
        <button className="launch" onClick={() => setOpen(true)}>Open command palette <kbd>⌘ / Ctrl K</kbd></button>
        <p className="hint">Search by typing · Use arrow keys and Enter · Escape to close</p>
      </section>
      <section className="examples" aria-label="Commands to try">
        <article><span>01</span><h2>Say hello</h2><p>Run a simple action instantly.</p></article>
        <article><span>02</span><h2>Open a project</h2><p>Load choices asynchronously.</p></article>
        <article><span>03</span><h2>Invite a teammate</h2><p>Walk through steps that adapt to your choices.</p></article>
      </section>
      <section className="lower">
        <div><h2>Try an error</h2><p>Make the project choices fail to load, then turn this off and try again.</p><label className="toggle"><input type="checkbox" checked={failLoading} onChange={(event) => setFailLoading(event.target.checked)} /> Simulate loading failure</label></div>
        <div><h2>Activity</h2><div className="activity" aria-live="polite">{activity.length ? activity.map((entry, index) => <p key={index}><strong>{entry.title}</strong><br />{entry.detail}</p>) : <p>Run a command to see what happens here.</p>}</div></div>
      </section>
      <CommandPalette commands={commands} strategies={strategies} plugins={plugins} open={open} onOpenChange={setOpen} renderProgress={progress => <div className="workflow-progress">
        <div>{progress.indeterminate ? `${progress.current} completed · More steps ahead` : `${progress.current} of ${progress.total} completed · ${progress.percentage}%`}</div>
        <Progress value={progress.percentage} />
      </div>} />
    </main>
  );
}
