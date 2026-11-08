import { describe, expect, it, vi } from 'vitest';
import { createCommandEngine } from './core';

describe('legacy conditional commands on close', () => {
  it('closes without re-evaluating a predicate on a closed workflow', () => {
    const when = vi.fn(() => true), onClose = vi.fn();
    const engine = createCommandEngine({ commands: [{ id: 'a', label: 'A', when, run: () => {} }], callbacks: { onClose } });
    expect(() => engine.close()).not.toThrow();
    expect(engine.getSnapshot().closed).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
    engine.destroy();
  });

  it('automatically completes and closes a conditional command', async () => {
    const run = vi.fn(), onClose = vi.fn();
    const engine = createCommandEngine({ commands: [{ id: 'a', label: 'A', when: () => true, run }], callbacks: { onClose } });
    engine.select(0);
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(engine.getSnapshot().closed).toBe(true);
    engine.destroy();
  });
});

describe('legacy predicate exceptions', () => {
  it('propagates a step predicate exception to select', () => {
    const failure = new Error('legacy step');
    const onError = vi.fn();
    const engine = createCommandEngine({ commands: [{ id: 'a', label: 'A', steps: [{ id: 's', label: 'S', when: () => { throw failure; }, options: [] }], run: () => {} }], callbacks: { onError } });
    expect(() => engine.select(0)).toThrow(failure);
    expect(onError).not.toHaveBeenCalled();
    engine.destroy();
  });
});
