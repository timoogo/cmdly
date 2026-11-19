import { useEffect, useMemo, useState } from 'react';
import { CommandBubble, type TokenFeedbackMode, type TokenFeedbackProps } from '@cmdly/react';
import type { EnginePlugin, EngineStrategies } from '@cmdly/core';
import { createCommands, type Activity } from './commands';
import { Progress } from './components/progress';
import { createTokenCommands, tokenOptions } from './tokens';
import './style.css';

// Optional extensions: these objects are stable across React renders.
const strategies: EngineStrategies = {
  closeOnComplete: (command, _answers, finalStep) => command.id === 'create' ? false : !finalStep || (finalStep.closeOnComplete ?? finalStep.timing === 'before'),
};
// Custom feedback component: global, receives the aggregated feedback from @cmdly/core.
function TokenChips({ feedback, tokens }: TokenFeedbackProps) {
  return <div className="token-chips" role="status" aria-live="polite" data-status={feedback.status}>{tokens.map(token => <span key={token.id} data-status={token.status}>{token.raw} · {token.status}</span>)}</div>;
}
const feedbackModes: Record<string, TokenFeedbackMode> = { banner: 'banner', loader: 'loader', none: 'none', custom: TokenChips };
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
  const [feedbackMode, setFeedbackMode] = useState('banner');
  const [bubbleMode, setBubbleMode] = useState<'trigger' | 'standalone'>('trigger');
  const commands = useMemo(() => {
    const record = (entry: Activity) => setActivity((items) => [entry, ...items]);
    return [...createTokenCommands(record), ...createCommands(record, failLoading)];
  }, [failLoading]);

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
        <div><h2>Try an error</h2><p>Make the project choices fail to load, then turn this off and try again.</p><label className="toggle"><input type="checkbox" checked={failLoading} onChange={(event) => setFailLoading(event.target.checked)} /> Simulate loading failure</label>
          <h2>Tokens</h2><p>Type <code>@alice</code>, <code>@nobody</code>, <code>#42</code>, <code>#bug</code> or <code>bob@example.com</code>. Tokens never filter commands: the remaining text does.</p>
          <label className="toggle">Token feedback <select value={feedbackMode} onChange={(event) => setFeedbackMode(event.target.value)}>{Object.keys(feedbackModes).map(mode => <option key={mode}>{mode}</option>)}</select></label>
          <h2>Command Bubble</h2><p>The ⌘ bubble in the corner opens the palette (trigger) or its own compact popover (standalone).</p>
          <label className="toggle">Bubble mode <select value={bubbleMode} onChange={(event) => { setOpen(false); setBubbleMode(event.target.value as 'trigger' | 'standalone'); }}><option>trigger</option><option>standalone</option></select></label></div>
        <div><h2>Activity</h2><div className="activity" aria-live="polite">{activity.length ? activity.map((entry, index) => <p key={index}><strong>{entry.title}</strong><br />{entry.detail}</p>) : <p>Run a command to see what happens here.</p>}</div></div>
      </section>
      {/* The bubble shares its open state with the launch button and the ⌘/Ctrl K shortcut. */}
      <CommandBubble mode={bubbleMode} trigger={<span aria-hidden="true">⌘</span>} className="bubble" commands={commands} tokens={tokenOptions} tokenFeedback={feedbackModes[feedbackMode]} strategies={strategies} plugins={plugins} open={open} onOpenChange={setOpen} renderProgress={progress => <div className="workflow-progress">
        <div>{progress.indeterminate ? `${progress.current} completed · More steps ahead` : `${progress.current} of ${progress.total} completed · ${progress.percentage}%`}</div>
        <Progress value={progress.percentage} />
      </div>} />
    </main>
  );
}
