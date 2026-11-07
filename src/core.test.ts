import { describe, expect, it, vi } from 'vitest';
import { createCommandEngine } from './core';

const option = { value: 'prod', label: 'Production' };

describe('command engine', () => {
  it('publishes stable snapshots and unsubscribes listeners', () => {
    const engine = createCommandEngine({ commands: [{ id: 'x', label: 'X', steps: [{ id: 'env', label: 'Environment', options: [option] }], run: () => {} }] });
    const listener = vi.fn();
    const unsubscribe = engine.subscribe(listener);
    const initial = engine.getSnapshot();
    expect(engine.getSnapshot()).toBe(initial);
    engine.select(0);
    expect(engine.getSnapshot().phase).toBe('step');
    expect(listener).toHaveBeenCalled();
    unsubscribe();
    listener.mockClear();
    engine.back();
    expect(listener).not.toHaveBeenCalled();
    engine.destroy();
  });

  it('uses inherited answers and the closest final step', () => {
    const engine = createCommandEngine({ commands: [{ id: 'parent', label: 'Parent', finalStep: { timing: 'after' }, steps: [{ id: 'env', label: 'Environment', options: [option] }], commands: [{ id: 'child', label: 'Child', finalStep: { timing: 'before' }, run: () => {} }] }] });
    engine.select(0);
    engine.select(0);
    engine.select(0);
    expect(engine.getSnapshot().phase).toBe('final');
    expect(engine.getSnapshot().answers).toEqual({ env: 'prod' });
    expect(engine.getSnapshot().finalStep?.timing).toBe('before');
    engine.destroy();
  });

  it('runs only after confirmation for a before final step', async () => {
    const run = vi.fn();
    const engine = createCommandEngine({ commands: [{ id: 'x', label: 'X', finalStep: { timing: 'before' }, run }] });
    engine.select(0);
    expect(engine.getSnapshot().phase).toBe('final');
    expect(run).not.toHaveBeenCalled();
    await engine.execute();
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith({});
    engine.destroy();
  });

  it('ignores a final step when its condition is false', async () => {
    const run = vi.fn();
    const engine = createCommandEngine({ commands: [{ id: 'x', label: 'X', finalStep: { timing: 'before', when: () => false }, run }] });
    engine.select(0);
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(engine.getSnapshot().phase).not.toBe('final');
    engine.destroy();
  });

  it('protects asynchronous execution from duplicate calls', async () => {
    let resolve!: () => void;
    const run = vi.fn(() => new Promise<void>(done => { resolve = done; }));
    const engine = createCommandEngine({ commands: [{ id: 'x', label: 'X', finalStep: { timing: 'before', closeOnComplete: false }, run }] });
    engine.select(0);
    const first = engine.execute();
    const second = engine.execute();
    expect(run).toHaveBeenCalledTimes(1);
    resolve();
    await Promise.all([first, second]);
    engine.destroy();
  });

  it('shows an after final step only after successful execution', async () => {
    let resolve!: () => void;
    const run = vi.fn(() => new Promise<void>(done => { resolve = done; }));
    const engine = createCommandEngine({ commands: [{ id: 'x', label: 'X', finalStep: { timing: 'after', closeOnComplete: false }, run }] });
    engine.select(0);
    expect(run).toHaveBeenCalledTimes(1);
    expect(engine.getSnapshot().phase).not.toBe('final');
    resolve();
    await vi.waitFor(() => expect(engine.getSnapshot().phase).toBe('final'));
    engine.destroy();
  });

  it('exposes a failed execution and permits retry', async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValueOnce(undefined);
    const engine = createCommandEngine({ commands: [{ id: 'x', label: 'X', finalStep: { timing: 'before', closeOnComplete: false }, run }] });
    engine.select(0);
    await engine.execute();
    expect(engine.getSnapshot().phase).toBe('final');
    expect(engine.getSnapshot().error).toBeTruthy();
    engine.retry();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    engine.destroy();
  });

  it('discards a late result after destruction', async () => {
    let resolve!: () => void;
    const engine = createCommandEngine({ commands: [{ id: 'x', label: 'X', finalStep: { timing: 'before' }, run: () => new Promise<void>(done => { resolve = done; }) }] });
    const listener = vi.fn();
    engine.select(0);
    const pending = engine.execute();
    engine.subscribe(listener);
    engine.destroy();
    listener.mockClear();
    resolve();
    await pending;
    expect(listener).not.toHaveBeenCalled();
  });


  it('calls lifecycle callbacks and applies a transition strategy', async () => {
    const onNavigate = vi.fn(), onExecute = vi.fn(), onClose = vi.fn();
    const engine = createCommandEngine({ commands: [{ id: 'x', label: 'X', finalStep: { timing: 'before' }, run: () => {} }], callbacks: { onNavigate, onExecute, onClose }, strategies: { allowTransition: (_state, action) => action !== 'back' } });
    engine.select(0);
    engine.back();
    expect(engine.getSnapshot().phase).toBe('final');
    await engine.execute();
    expect(onNavigate).toHaveBeenCalled();
    expect(onExecute).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    engine.destroy();
  });

  it('sets up plugins in order and cleans up in reverse order even if one cleanup throws', () => {
    const events: string[] = [];
    const engine = createCommandEngine({ commands: [], plugins: [
      { setup: () => { events.push('setup a'); return () => { events.push('cleanup a'); }; } },
      { setup: () => { events.push('setup b'); return () => { events.push('cleanup b'); throw new Error('cleanup'); }; } },
    ] });
    expect(() => engine.destroy()).toThrow('cleanup');
    expect(events).toEqual(['setup a', 'setup b', 'cleanup b', 'cleanup a']);
  });

  it('isolates state and plugin subscriptions between engine instances', () => {
    const listener = vi.fn();
    const commands = [{ id: 'x', label: 'X', steps: [{ id: 'env', label: 'Environment', options: [option] }], run: () => {} }];
    const first = createCommandEngine({ commands, plugins: [{ setup: engine => engine.subscribe(listener) }] });
    const second = createCommandEngine({ commands });
    second.select(0);
    expect(listener).not.toHaveBeenCalled();
    expect(first.getSnapshot().phase).toBe('menu');
    first.destroy();
    second.destroy();
  });


  it('filters, reorders and relabels the active summary', () => {
    const engine = createCommandEngine({ commands: [{ id: 'x', label: 'X', steps: [
      { id: 'env', label: 'Environment', options: [option] },
      { id: 'region', label: 'Region', options: [{ value: 'eu', label: 'Europe' }] },
    ], finalStep: { timing: 'before', fields: [{ id: 'region', label: 'Location' }] }, run: () => {} }] });
    engine.select(0); engine.select(0); engine.select(0);
    expect(engine.getSnapshot().summary).toEqual([{ id: 'region', label: 'Location', value: 'eu' }]);
    engine.back();
    expect(engine.getSnapshot().step?.id).toBe('region');
    engine.destroy();
  });

  it('supports global defaults and explicit final-step disable', async () => {
    const run = vi.fn();
    const engine = createCommandEngine({ defaults: { finalStep: { timing: 'before' } }, commands: [{ id: 'parent', label: 'Parent', commands: [{ id: 'child', label: 'Child', finalStep: false, run }] }] });
    engine.select(0); engine.select(0);
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(engine.getSnapshot().phase).not.toBe('final');
    engine.destroy();
  });

  it('reports execution errors through the callback', async () => {
    const failure = new Error('Failed');
    const onError = vi.fn();
    const engine = createCommandEngine({ commands: [{ id: 'x', label: 'X', finalStep: { timing: 'before' }, run: () => { throw failure; } }], callbacks: { onError } });
    engine.select(0);
    await engine.execute();
    expect(onError).toHaveBeenCalledWith(failure, expect.anything());
    expect(engine.getSnapshot().error).toBe(failure);
    engine.destroy();
  });


  it('honours explicit closeOnComplete for a before final step', async () => {
    const engine = createCommandEngine({ commands: [{ id: 'x', label: 'X', finalStep: { timing: 'before', closeOnComplete: false }, run: () => {} }] });
    engine.select(0);
    await engine.execute();
    expect(engine.getSnapshot().closed).toBe(false);
    expect(engine.getSnapshot().status).toBe('success');
    engine.destroy();
  });

  it('ignores a late execution result after close', async () => {
    let resolve!: () => void;
    const engine = createCommandEngine({ commands: [{ id: 'x', label: 'X', finalStep: { timing: 'before' }, run: () => new Promise<void>(done => { resolve = done; }) }] });
    engine.select(0);
    const pending = engine.execute();
    engine.close();
    const closed = engine.getSnapshot();
    resolve();
    await pending;
    expect(engine.getSnapshot()).toBe(closed);
    expect(engine.getSnapshot().closed).toBe(true);
    engine.destroy();
  });


  it('reevaluates the after condition after execution', async () => {
    let show = true;
    const engine = createCommandEngine({ commands: [{ id: 'x', label: 'X', finalStep: { timing: 'after', when: () => show }, run: () => { show = false; } }] });
    engine.select(0);
    await vi.waitFor(() => expect(engine.getSnapshot().closed).toBe(true));
    engine.destroy();
  });

  it('respects a strategy that refuses close', () => {
    const engine = createCommandEngine({ commands: [], strategies: { allowTransition: (_state, action) => action !== 'close' } });
    engine.close();
    expect(engine.getSnapshot().closed).toBe(false);
    engine.destroy();
  });

  it('updates command definitions and final step without resetting the active workflow', () => {
    const run = vi.fn();
    const engine = createCommandEngine({ commands: [{ id: 'x', label: 'Old', finalStep: { timing: 'before', fields: [] }, run }] });
    engine.select(0);
    engine.setOptions({ commands: [{ id: 'x', label: 'New', finalStep: { timing: 'before', closeOnComplete: false }, run }] });
    expect(engine.getSnapshot().phase).toBe('final');
    expect(engine.getSnapshot().command?.label).toBe('New');
    expect(engine.getSnapshot().finalStep?.closeOnComplete).toBe(false);
    engine.destroy();
  });

});
