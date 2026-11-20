// @vitest-environment jsdom
import React, { StrictMode, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  CommandBubble, CommandPalette, createCommandEngine, useCommandCombobox, useCommandSession,
  type Command, type CommandCombobox, type CommandEngine, type TokenRunContext,
} from '@cmdly/react';

afterEach(cleanup);

const trigger = () => screen.getByRole('button', { name: 'Command palette' });
const alive = (engine: CommandEngine) => {
  let notified = 0;
  const off = engine.subscribe(() => { notified++; });
  const query = engine.getSnapshot().query;
  engine.setQuery(`${query}?`); engine.setQuery(query);
  off();
  return notified > 0;
};

function List({ command }: { command: CommandCombobox }) {
  return <>
    <input aria-label={command.state.step?.label ?? 'Find'} {...command.inputProps} />
    {command.listVisible && <ul {...command.listboxProps}>{command.visibleItems.map(({ item, index }) => <li key={index} {...command.getOptionProps(index)}>{item.label}</li>)}</ul>}
  </>;
}

describe('integration', () => {
  it('shares one external session successively between the palette, the standalone bubble and a headless view', async () => {
    const user = userEvent.setup(), run = vi.fn();
    const engine = createCommandEngine({ commands: [
      { id: 'deploy', label: 'Deploy', steps: [{ id: 'env', label: 'Environment', options: [{ value: 'prod', label: 'Production' }, { value: 'dev', label: 'Development' }] }], run },
    ] });
    function Headless({ onDismiss }: { onDismiss: () => void }) {
      const command = useCommandCombobox(engine, { onDismiss });
      return <section aria-label="Headless" {...command.rootProps}><List command={command} /></section>;
    }
    function App() {
      const [view, setView] = useState<'palette' | 'bubble' | 'headless' | null>('palette');
      const hide = () => setView(null);
      return <>
        <button onClick={() => setView('bubble')}>Show bubble</button>
        <button onClick={() => setView('headless')}>Show headless</button>
        <CommandPalette engine={engine} open={view === 'palette'} onOpenChange={open => { if (!open) hide(); }} label="Palette" />
        {view !== 'palette' && <CommandBubble mode="standalone" engine={engine} open={view === 'bubble'} onOpenChange={open => setView(open ? 'bubble' : null)} />}
        {view === 'headless' && <Headless onDismiss={hide} />}
      </>;
    }
    render(<App />);
    await user.keyboard('{Enter}'); // Deploy → Environment, in the palette
    await user.type(screen.getByRole('combobox', { name: 'Environment' }), 'dev');
    await user.keyboard('{Escape}{Escape}'); // step → menu, then dismiss (UI only)
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(engine.getSnapshot()).toMatchObject({ closed: false, query: '' });

    await user.click(screen.getByRole('button', { name: 'Show bubble' }));
    await user.keyboard('{Enter}'); // Deploy again, from the popover
    await user.type(screen.getByRole('combobox', { name: 'Environment' }), 'dev');
    await user.click(screen.getByRole('button', { name: 'Show headless' })); // outside press: popover hidden
    expect(screen.queryByRole('dialog')).toBeNull();
    const input = screen.getByRole('combobox', { name: 'Environment' }); // the headless view resumes the step
    expect((input as HTMLInputElement).value).toBe('dev');
    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['Development']);
    await user.click(screen.getByRole('option', { name: 'Development' }));
    await waitFor(() => expect(run).toHaveBeenCalledOnce());
    expect(run.mock.calls[0][0]).toEqual({ env: 'dev' });
    expect(engine.getSnapshot().closed).toBe(true); // completion closes the session itself
    engine.destroy();
  });

  it('keeps sessions, listeners and focus correct under StrictMode', async () => {
    const user = userEvent.setup(), run = vi.fn(), onClose = vi.fn();
    const commands: Command[] = [{ id: 'a', label: 'Alpha', run }, { id: 'b', label: 'Beta', run: vi.fn() }];
    function Panel({ onDone }: { onDone: () => void }) {
      const engine = useCommandSession({ commands, callbacks: { onClose: () => { onClose(); onDone(); } } });
      const command = useCommandCombobox(engine);
      return <section aria-label="Panel" {...command.rootProps}><List command={command} /></section>;
    }
    function App() {
      const [panel, setPanel] = useState(true);
      return <>
        <CommandBubble mode="standalone" commands={commands}>{command => <List command={command} />}</CommandBubble>
        <button>Outside</button>
        {panel && <Panel onDone={() => setPanel(false)} />}
      </>;
    }
    render(<StrictMode><App /></StrictMode>);
    await act(async () => { await Promise.resolve(); }); // let a replayed unmount run its deferred destroy
    // The headless session survived the StrictMode replay.
    await user.click(screen.getByRole('option', { name: 'Beta' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Panel' })).toBeNull());
    expect(onClose).toHaveBeenCalledOnce();

    await user.click(trigger());
    expect(document.activeElement).toBe(screen.getByRole('combobox'));
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(run).toHaveBeenCalledOnce(); // run once, not replayed
    expect(document.activeElement).toBe(trigger());
    await user.click(trigger());
    await user.click(screen.getByRole('button', { name: 'Outside' })); // one outside listener: closes once, cleanly
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });

  it('combines async options, a load failure, retry and pointer selection in the standalone popover', async () => {
    const user = userEvent.setup(), run = vi.fn();
    let attempts = 0;
    const commands: Command[] = [{ id: 'pick', label: 'Pick a region', steps: [{ id: 'region', label: 'Region', options: async () => {
      attempts++;
      if (attempts === 1) throw new Error('offline');
      return [{ value: 'eu', label: 'Europe' }, { value: 'us', label: 'United States' }];
    } }], run }];
    render(<CommandBubble mode="standalone" commands={commands} />);
    await user.click(trigger());
    await user.click(screen.getByRole('option', { name: 'Pick a region' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('offline');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await user.hover(await screen.findByRole('option', { name: 'United States' }));
    expect(screen.getByRole('option', { name: 'United States' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('dialog')).toBeTruthy(); // still open across the multi-step flow
    await user.click(screen.getByRole('option', { name: 'United States' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(run.mock.calls[0][0]).toEqual({ region: 'us' });
  });

  it('runs a command with tokens through steps, and aborts it when an owned session is closed', async () => {
    const user = userEvent.setup();
    const signals: (AbortSignal | undefined)[] = [], received: unknown[] = [];
    const commands: Command[] = [{
      id: 'assign', label: 'Assign',
      steps: [{ id: 'priority', label: 'Priority', options: [{ value: 'high', label: 'High' }] }],
      run: (answers: unknown, context?: Partial<TokenRunContext>) => { received.push(answers, context?.tokens?.map(token => token.value)); signals.push(context?.signal); return new Promise(() => {}); },
    }];
    render(<><CommandBubble mode="standalone" commands={commands} tokens={{ types: [{ id: 'user', prefix: '@', values: [{ value: 'alice' }] }] }} /><button>Outside</button></>);
    await user.click(trigger());
    await user.type(screen.getByRole('combobox'), 'assign @alice');
    await user.keyboard('{Enter}');
    expect(screen.getByRole('combobox', { name: 'Priority' })).toBeTruthy();
    await user.keyboard('{Enter}');
    expect(screen.getByText('Running command…')).toBeTruthy();
    expect(received).toEqual([{ priority: 'high' }, ['alice']]);
    await user.click(screen.getByRole('button', { name: 'Outside' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(signals[0]?.aborted).toBe(true);
  });
});

it('a shared external engine survives every interface being unmounted', async () => {
  const engine = createCommandEngine({ commands: [{ id: 'a', label: 'Alpha', run: vi.fn() }] });
  const view = render(<StrictMode><CommandBubble engine={engine} defaultOpen /><CommandPalette engine={engine} open={false} onOpenChange={() => {}} /></StrictMode>);
  view.unmount();
  await act(async () => { await Promise.resolve(); });
  expect(engine.getSnapshot().closed).toBe(false);
  expect(alive(engine)).toBe(true);
  engine.destroy();
});
