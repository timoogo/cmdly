import { describe, expect, it, vi } from 'vitest';
import { createCommandEngine, type Command, type EngineSnapshot, type FinalStep } from './core';

const step = { id: 'choice', label: 'Choice', options: [{ value: 'a', label: 'A' }] };
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };

describe('workflow lifecycle', () => {
  it('executes once and closes without a final step, without publishing a final screen', async () => {
    const pending = deferred<string>(), events: string[] = [];
    const run = vi.fn(() => { events.push('run'); return pending.promise; });
    const engine = createCommandEngine({ commands: [{ id: 'x', label: 'X', steps: [step], run }], callbacks: { onExecute: () => events.push('execute'), onClose: () => events.push('close') } });
    engine.subscribe(() => { const s = engine.getSnapshot(); events.push(`${s.phase}:${s.status}:${s.closed}`); });
    engine.select(0); engine.select(0);
    expect(events).toEqual(['step:idle:false', 'running:loading:false', 'execute', 'run']);
    expect(run).toHaveBeenCalledTimes(1);
    pending.resolve('done');
    await vi.waitFor(() => expect(engine.getSnapshot().closed).toBe(true));
    expect(events).toEqual(['step:idle:false', 'running:loading:false', 'execute', 'run', 'menu:idle:true', 'close']);
    engine.destroy();
  });

  it('waits for confirmation before execution and permits back', async () => {
    const run = vi.fn().mockResolvedValue('done');
    const engine = createCommandEngine({ commands: [{ id: 'x', label: 'X', steps: [step], finalStep: { timing: 'before', closeOnComplete: false }, run }] });
    engine.select(0); engine.select(0);
    expect(engine.getSnapshot().phase).toBe('final'); expect(run).not.toHaveBeenCalled();
    engine.back(); expect(engine.getSnapshot().step?.id).toBe('choice');
    engine.select(0); expect(run).not.toHaveBeenCalled();
    await engine.execute();
    expect(run).toHaveBeenCalledOnce(); expect(run).toHaveBeenCalledWith({ choice: 'a' });
    expect(engine.getSnapshot()).toMatchObject({ phase: 'final', status: 'success', result: 'done', closed: false });
    engine.destroy();
  });

  it.each([false, true])('after executes before final screen with closeOnComplete=%s', async closeOnComplete => {
    const pending = deferred<string>(), run = vi.fn(() => pending.promise), seen: EngineSnapshot[] = [], onClose = vi.fn();
    const engine = createCommandEngine({ commands: [{ id: 'x', label: 'X', steps: [step], finalStep: { timing: 'after', closeOnComplete }, run }], callbacks: { onClose } });
    engine.subscribe(() => seen.push(engine.getSnapshot()));
    engine.select(0); engine.select(0);
    expect(run).toHaveBeenCalledOnce(); expect(engine.getSnapshot()).toMatchObject({ phase: 'running', status: 'loading', closed: false });
    expect(seen.some(s => s.phase === 'final')).toBe(false);
    pending.resolve('result');
    await vi.waitFor(() => expect(engine.getSnapshot().closed || engine.getSnapshot().status === 'success').toBe(true));
    if (closeOnComplete) { expect(engine.getSnapshot().closed).toBe(true); expect(onClose).toHaveBeenCalledOnce(); }
    else { expect(engine.getSnapshot()).toMatchObject({ phase: 'final', answers: { choice: 'a' }, result: 'result', closed: false }); expect(onClose).not.toHaveBeenCalled(); }
    engine.destroy();
  });

  it('skips a false after condition even when a strategy prevents closing', async () => {
    const engine = createCommandEngine({ commands: [{ id: 'x', label: 'X', finalStep: { timing: 'after', when: () => false }, run: () => 'done' }], strategies: { allowTransition: (_, action) => action !== 'close' } });
    engine.select(0);
    await vi.waitFor(() => expect(engine.getSnapshot().status).toBe('success'));
    expect(engine.getSnapshot().closed).toBe(false);
    expect(engine.getSnapshot().finalStep).toBeNull();
    engine.destroy();
  });

  it('retains a failure after back and forward and allows retry', async () => {
    const failure = new Error('failed'), run = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce('ok');
    const engine = createCommandEngine({ commands: [{ id: 'x', label: 'X', steps: [step], finalStep: { timing: 'before', closeOnComplete: false }, run }] });
    engine.select(0); engine.select(0); await engine.execute();
    expect(engine.getSnapshot()).toMatchObject({ status: 'error', error: failure });
    engine.back(); engine.forward();
    expect(engine.getSnapshot()).toMatchObject({ phase: 'final', status: 'error', error: failure });
    engine.retry(); await vi.waitFor(() => expect(engine.getSnapshot().status).toBe('success'));
    expect(run).toHaveBeenCalledTimes(2);
    engine.destroy();
  });

  it('inherits final configuration recursively, allows override and explicit disable', async () => {
    const run = vi.fn(), inherited: FinalStep = { timing: 'before', closeOnComplete: false };
    const leaf = (finalStep?: FinalStep | false): Command => ({ id: 'leaf', label: 'Leaf', finalStep, run });
    const make = (child: Command) => createCommandEngine({ defaults: { finalStep: inherited }, commands: [{ id: 'a', label: 'A', finalStep: { closeOnComplete: true }, commands: [{ id: 'b', label: 'B', commands: [child] }] }] });
    const engine = make(leaf({ closeOnComplete: false }));
    engine.select(0); engine.select(0); engine.select(0);
    expect(engine.getSnapshot().finalStep).toMatchObject({ timing: 'before', closeOnComplete: false }); expect(run).not.toHaveBeenCalled(); engine.destroy();
    const disabled = make(leaf(false));
    disabled.select(0); disabled.select(0); disabled.select(0);
    await vi.waitFor(() => expect(disabled.getSnapshot().closed).toBe(true));
    expect(run).toHaveBeenCalledOnce(); disabled.destroy();
  });

  it('ignores an async result after the palette closes', async () => {
    const pending = deferred<string>(), engine = createCommandEngine({ commands: [{ id: 'x', label: 'X', finalStep: { timing: 'after' }, run: () => pending.promise }] });
    engine.select(0); engine.close(); const closed = engine.getSnapshot(); pending.resolve('late');
    await pending.promise; await Promise.resolve();
    expect(engine.getSnapshot()).toBe(closed); expect(closed.closed).toBe(true); engine.destroy();
  });
});
