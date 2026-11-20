import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCommandEngine, type Command } from '@cmdly/core';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { createCommands } from './commands';

afterEach(() => { vi.useRealTimers(); });
const find = (id: string, record = vi.fn(), fail = () => false) => createCommands(record, fail).find(command => command.id === id)!;
const labels = (engine: ReturnType<typeof createCommandEngine>) => engine.getSnapshot().items.map(item => item.label);
async function engineFor(command: Command) {
  vi.useFakeTimers();
  const engine = createCommandEngine({ commands: [command] });
  engine.select(0);
  return { engine, settle: () => vi.runAllTimersAsync() };
}

describe('playground demonstrations', () => {
  it('Open a project: async steps, observable progress 0 → 100 %, and the failure toggle', async () => {
    let fail = true;
    const record = vi.fn();
    const { engine, settle } = await engineFor(find('open-project', record, () => fail));
    await settle();
    expect(engine.getSnapshot()).toMatchObject({ loadFailed: true, error: expect.objectContaining({ message: 'Workspace service unavailable' }) });
    fail = false;
    engine.retry();
    expect(engine.getSnapshot().loading).toBe(true);
    await settle();
    expect(engine.getSnapshot().progress?.percentage).toBe(0);
    engine.select(0); await settle();
    expect(engine.getSnapshot().progress?.percentage).toBe(33);
    engine.select(0); await settle();
    expect(engine.getSnapshot().progress?.percentage).toBe(67);
    engine.select(1);
    expect(engine.getSnapshot()).toMatchObject({ phase: 'running', running: true, progress: { indeterminate: true } });
    await settle();
    expect(engine.getSnapshot()).toMatchObject({ status: 'success', closed: false, progress: { percentage: 100 } });
    expect(record).toHaveBeenCalledWith({ title: 'Project opened', detail: 'Design / Website @ develop' });
    engine.destroy();
  });

  it('Open a project: the final step shows a success title, readable labels and Close', () => {
    const { finalStep } = find('open-project');
    if (!finalStep || !finalStep.render) throw new Error('missing custom final step');
    const html = renderToStaticMarkup(finalStep.render({ answers: { workspace: 'platform', project: 'api', branch: 'main' }, status: 'success', summary: [], error: null, result: undefined, execute: async () => {}, back: () => {}, close: () => {} }) as ReactElement);
    expect(html).toContain('Project opened');
    expect(html).toMatch(/Platform.*Public API.*main/);
    expect(html).not.toMatch(/>platform<|>api</);
    expect(html).toContain('>Close</button>');
  });

  it('Open a project: an empty workspace shows no options', async () => {
    const { engine, settle } = await engineFor(find('open-project'));
    await settle();
    engine.select(2); await settle();
    expect(engine.getSnapshot()).toMatchObject({ loading: false, loadFailed: false, items: [] });
    engine.destroy();
  });

  it('Invite a teammate: the access step only appears for admins', async () => {
    const record = vi.fn();
    const { engine } = await engineFor(find('invite', record));
    engine.select(1); engine.select(0);
    expect(record).toHaveBeenLastCalledWith({ title: 'Invitation sent', detail: 'bob as member' });
    const admin = createCommandEngine({ commands: [find('invite', record)] });
    admin.select(0); admin.select(0); admin.select(1);
    expect(admin.getSnapshot().step?.label).toBe('Admin access');
    admin.select(1);
    expect(record).toHaveBeenLastCalledWith({ title: 'Invitation sent', detail: 'alice as admin (full)' });
    engine.destroy(); admin.destroy();
  });

  it('Deploy: production asks for confirmation, staging runs directly', async () => {
    const record = vi.fn();
    const { engine, settle } = await engineFor(find('deploy', record));
    engine.select(1);
    expect(engine.getSnapshot().phase).toBe('final');
    expect(record).not.toHaveBeenCalled();
    void engine.execute(); await settle();
    expect(record).toHaveBeenCalledOnce();
    expect(record).toHaveBeenCalledWith({ title: 'Deployed', detail: 'production' });
    expect(engine.getSnapshot()).toMatchObject({ closed: false, phase: 'final', status: 'success' }); // result kept open
    const staging = createCommandEngine({ commands: [find('deploy', record)] });
    staging.select(0); staging.select(0);
    expect(staging.getSnapshot().running).toBe(true);
    await settle();
    expect(staging.getSnapshot().closed).toBe(true); // no final step: closes automatically
    engine.destroy(); staging.destroy();
  });

  it('Sync data: the first run fails and Retry succeeds', async () => {
    const record = vi.fn();
    const { engine, settle } = await engineFor(find('sync', record));
    await settle();
    expect(engine.getSnapshot()).toMatchObject({ status: 'error', error: expect.objectContaining({ message: 'Temporary failure — try again' }) });
    void engine.execute(); await settle();
    expect(engine.getSnapshot().status).toBe('success');
    expect(record).toHaveBeenCalledWith({ title: 'Data synced', detail: 'The retry succeeded.' });
    engine.destroy();
  });

  it('Git: Advanced mode unlocks a conditional child command', async () => {
    const { engine } = await engineFor(find('git'));
    engine.select(0); engine.select(0);
    expect(labels(engine)).toEqual(['List branches']);
    engine.back(); engine.back(); engine.select(1); engine.select(0);
    expect(labels(engine)).toEqual(['List branches', 'Create branch']);
    engine.destroy();
  });

  it('Back behavior: going back pre-selects what each strategy remembers', async () => {
    const preselected: Record<string, string[]> = {};
    for (const [index, mode] of ['preserve', 'reset', 'smart'].entries()) {
      preselected[mode] = [];
      for (const environment of [0, 1]) { // Staging (changed), then Production (unchanged)
        const { engine, settle } = await engineFor(find('back-behavior'));
        engine.select(index);
        engine.select(1); await settle(); engine.select(1); // Production → United States
        engine.back(); engine.back();
        engine.select(environment); await settle();
        const snapshot = engine.getSnapshot();
        preselected[mode].push(snapshot.items[snapshot.active].label);
        engine.destroy();
      }
    }
    expect(preselected).toEqual({
      preserve: ['United States', 'United States'],
      reset: ['Europe', 'Europe'],
      smart: ['Europe', 'United States'],
    });
  });

  it('Large list: 10,000 options, 20 rendered at a time', () => {
    const command = find('large-list');
    expect(command.maxVisibleItems).toBe(20);
    expect(command.steps?.[0].options).toHaveLength(10_000);
  });
});

describe('playground tokens', () => {
  it('resolves # collisions, validates users asynchronously and runs with tokens', async () => {
    const { createTokenCommands, tokenOptions } = await import('./tokens');
    const record = vi.fn();
    const engine = createCommandEngine({ commands: createTokenCommands(record), tokens: tokenOptions });
    engine.setQuery('assign @alice #42 #bug bob@example.com');
    expect(engine.getSnapshot().text).toBe('assign');
    expect(engine.getSnapshot().tokens.map(token => `${token.type}:${token.status}`)).toEqual(['user:pending', 'issue:valid', 'label:valid', 'email:valid']);
    engine.select(0);
    engine.setQuery('!high');
    expect(engine.getSnapshot().tokens.map(token => `${token.type}:${token.status}`)).toEqual(['priority:valid']);
    engine.select(1);
    await vi.waitFor(() => expect(record).toHaveBeenCalled(), { timeout: 2000 });
    expect(record.mock.calls[0][0].detail).toContain('urgent · Alice Martin');
  });
});
