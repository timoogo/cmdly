import { describe, expect, it, vi } from 'vitest';
import { createCommandEngine } from '@cmdly/core';

describe('execution cancellation during notification', () => {
  it.each(['close', 'destroy'] as const)('does not run after a subscriber calls %s', action => {
    const run = vi.fn();
    const engine = createCommandEngine({ commands: [{ id: 'x', label: 'X', run }] });
    engine.subscribe(() => {
      if (engine.getSnapshot().running) engine[action]();
    });
    engine.select(0);
    expect(run).not.toHaveBeenCalled();
    engine.destroy();
  });

  it('does not run if onExecute closes the engine', () => {
    const run = vi.fn();
    const engine = createCommandEngine({
      commands: [{ id: 'x', label: 'X', run }],
      callbacks: { onExecute: () => engine.close() },
    });
    engine.select(0);
    expect(run).not.toHaveBeenCalled();
    expect(engine.getSnapshot().closed).toBe(true);
    engine.destroy();
  });

  it('does not reveal a skipped before step when its condition changes during execution', async () => {
    let enabled = false;
    const engine = createCommandEngine({
      commands: [{ id: 'x', label: 'X', finalStep: { timing: 'before', when: () => enabled }, run: () => { enabled = true; } }],
      strategies: { closeOnComplete: () => false },
    });
    engine.select(0);
    await vi.waitFor(() => expect(engine.getSnapshot().status).toBe('success'));
    expect(engine.getSnapshot().finalStep).toBeNull();
    engine.destroy();
  });
});
