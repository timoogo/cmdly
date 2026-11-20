import { useEffect, useMemo, useRef, useState } from 'react';
import { CommandBubble, CommandPalette, createCommandEngine, type CommandEngine, type EnginePlugin, type TokenFeedbackMode, type TokenFeedbackProps } from '@cmdly/react';
import { createCommands, type Activity } from './commands';
import { WorkflowProgressView } from './components/progress';
import { CompactContent, PillTrigger } from './components/custom-bubble';
import { SharedSession } from './components/shared-session';
import { createTokenCommands, tokenOptions } from './tokens';
import './style.css';

// Custom feedback component: global, receives the aggregated feedback from @cmdly/core.
function TokenChips({ feedback, tokens }: TokenFeedbackProps) {
  return <div className="token-chips" role="status" aria-live="polite" data-status={feedback.status}>{tokens.map(token => <span key={token.id} data-status={token.status}>{token.raw} · {token.status}</span>)}</div>;
}
const feedbackModes: Record<string, TokenFeedbackMode> = { banner: 'banner', loader: 'loader', none: 'none', custom: TokenChips };

/** Each entry opens a palette already searching for the command that demonstrates the feature. */
const tryIt = [
  { feature: 'Simple command', query: 'Say hello', detail: 'Runs as soon as it is selected.' },
  { feature: 'Progress & async', query: 'Open a project', detail: 'Three async steps, a progress bar from 0 to 100 % and a running state. Turn on “Simulate loading failure” to see the error and Retry.' },
  { feature: 'Steps & conditions', query: 'Invite a teammate', detail: 'Choose Admin to get an extra step.' },
  { feature: 'Confirmation', query: 'Deploy', detail: 'Production asks for confirmation, then keeps the result open; Staging runs and closes directly.' },
  { feature: 'Errors & retry', query: 'Sync data', detail: 'The first run fails; Retry succeeds and the result stays open.' },
  { feature: 'Tokens', query: 'assign @alice #42', detail: 'Try @nobody, #bug, bob@example.com; !high in the Priority step.' },
  { feature: 'Nested commands', query: 'Git', detail: 'Advanced mode unlocks a child command; ← / → move between levels.' },
  { feature: 'Back behavior', query: 'Back behavior', detail: 'Pick Production → United States, press ← twice, then pick an environment: each strategy pre-selects a different region.' },
  { feature: 'Large list', query: 'Large list', detail: '10,000 options, 20 rendered at a time.' },
];

export default function App() {
  const [open, setOpen] = useState(false);
  const [failLoading, setFailLoading] = useState(false);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [feedbackMode, setFeedbackMode] = useState('banner');
  const [bubbleMode, setBubbleMode] = useState<'trigger' | 'standalone' | 'custom'>('trigger');
  const [launched, setLaunched] = useState<CommandEngine | null>(null);
  const fail = useRef(failLoading);
  fail.current = failLoading;

  // Stable for the whole page: the commands read the failure toggle when they load.
  const { commands, plugins } = useMemo(() => {
    const record = (entry: Activity) => setActivity(items => [entry, ...items]);
    // A plugin is installed on each engine; this one reports closed sessions in the Activity panel.
    const plugins: EnginePlugin[] = [{ setup(engine) {
      let reported = false;
      return engine.subscribe(() => {
        if (engine.getSnapshot().closed && !reported && (reported = true)) record({ title: 'Plugin', detail: 'Session closed (seen through engine.subscribe)' });
      });
    } }];
    return { commands: [...createTokenCommands(record), ...createCommands(record, () => fail.current)], plugins };
  }, []);

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
  // A "Try it" palette shows an engine created on click; it is destroyed once hidden or replaced.
  useEffect(() => () => launched?.destroy(), [launched]);
  function tryCommand(query: string) {
    const engine = createCommandEngine({ commands, tokens: tokenOptions, plugins });
    engine.setQuery(query);
    setOpen(false);
    setLaunched(engine);
  }

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
      <section className="try-it" aria-labelledby="try-it-title">
        <h2 id="try-it-title">Try it</h2>
        <ul>{tryIt.map(entry => <li key={entry.feature}>
          <button type="button" onClick={() => tryCommand(entry.query)}><strong>{entry.feature}</strong><span>{entry.query}</span></button>
          <p>{entry.detail}</p>
        </li>)}</ul>
      </section>
      <section className="lower">
        <div><h2>Settings</h2>
          <label className="toggle"><input type="checkbox" checked={failLoading} onChange={(event) => setFailLoading(event.target.checked)} /> Simulate loading failure <small>(Open a project)</small></label>
          <label className="toggle">Token feedback <select value={feedbackMode} onChange={(event) => setFeedbackMode(event.target.value)}>{Object.keys(feedbackModes).map(mode => <option key={mode}>{mode}</option>)}</select></label>
          <h2>Command Bubble</h2><p>The bubble in the corner opens the palette (trigger) or its own compact popover (standalone); custom replaces its trigger and content with the headless API.</p>
          <label className="toggle">Bubble mode <select value={bubbleMode} onChange={(event) => { setOpen(false); setBubbleMode(event.target.value as 'trigger' | 'standalone' | 'custom'); }}><option>trigger</option><option>standalone</option><option>custom</option></select></label>
          <SharedSession /></div>
        <div><h2>Activity</h2><div className="activity" aria-live="polite">{activity.length ? activity.map((entry, index) => <p key={index}><strong>{entry.title}</strong><br />{entry.detail}</p>) : <p>Run a command to see what happens here.</p>}</div></div>
      </section>
      {launched && <CommandPalette engine={launched} open onOpenChange={next => { if (!next) setLaunched(null); }} label="Try it" tokenFeedback={feedbackModes[feedbackMode]} renderProgress={progress => <WorkflowProgressView progress={progress} />} />}
      {/* The bubble shares its open state with the launch button and the ⌘/Ctrl K shortcut. */}
      {bubbleMode === 'custom' ? <CommandBubble mode="standalone" trigger={PillTrigger} className="custom-bubble" commands={commands} tokens={tokenOptions} plugins={plugins} open={open} onOpenChange={setOpen}>
        {command => <CompactContent command={command} />}
      </CommandBubble> : <CommandBubble mode={bubbleMode} trigger={<span aria-hidden="true">⌘</span>} className="bubble" commands={commands} tokens={tokenOptions} tokenFeedback={feedbackModes[feedbackMode]} plugins={plugins} open={open} onOpenChange={setOpen}
        renderProgress={progress => <WorkflowProgressView progress={progress} />} />}
    </main>
  );
}
