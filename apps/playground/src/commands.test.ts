import { describe, expect, it, vi } from 'vitest';
import { createCommands } from './commands';
import { createCommandEngine } from '@cmdly/core';

describe('playground stress commands', () => {
  it('configures the large list limit on the command', async () => {
    const record = vi.fn();
    const command = createCommands(record, false).find(item => item.id === 'stress-large-list')!;
    expect(command.maxVisibleItems).toBe(20);
    expect(command.steps?.[0].options).toHaveLength(10_000);
    await command.run!({ item: 'item-9999' });
    expect(record).toHaveBeenCalledWith({ title: 'Large list completed', detail: 'item-9999' });
  });
  it('preserves the conditional workflow', async () => {
    const command = createCommands(() => {}, false).find(item => item.id === 'stress-conditional')!;
    expect(command.steps?.[1].when?.({ mode: 'simple' })).toBe(false);
    expect(command.steps?.[1].when?.({ mode: 'advanced' })).toBe(true);
  });
  it('demonstrates nested commands with a conditional child', () => {
    const git = createCommands(() => {}, false).find(item => item.id === 'git')!;
    const branches = git.commands![0];
    const create = branches.commands!.find(item => item.id === 'create')!;
    expect(git.steps?.[0].id).toBe('mode');
    expect(create.when?.({ mode: 'standard' })).toBe(false);
    expect(create.when?.({ mode: 'advanced' })).toBe(true);
    expect(create.steps?.[0].id).toBe('base');
  });

});

describe('smart async validation examples', () => {
  const loadOptions = async () => {
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(400);
  };

  it.each([
    ['a', 'shared', 0, 0],
    ['a', 'a-only', 0, 1],
    ['b', 'b-only', 1, 1],
  ])('runs the historical command with dataset %s and item %s', async (dataset, item, datasetIndex, itemIndex) => {
    vi.useFakeTimers();
    try {
      const record = vi.fn();
      const command = createCommands(record, false).find(value => value.id === 'test-async-invalidation')!;
      const engine = createCommandEngine({ commands: [command] });
      engine.select(0);
      engine.select(datasetIndex);
      await loadOptions();
      engine.select(itemIndex);
      engine.select(0);
      await Promise.resolve();
      expect(record).toHaveBeenCalledOnce();
      expect(record).toHaveBeenCalledWith({ title: 'Async validation completed', detail: JSON.stringify({ dataset, item, confirm: 'yes' }) });
      expect(engine.getSnapshot().closed).toBe(true);
      engine.destroy();
    } finally { vi.useRealTimers(); }
  });

  it('invalidates a saved item when changing dataset and reloads async options', async () => {
    vi.useFakeTimers();
    try {
      const command = createCommands(() => {}, false).find(value => value.id === 'test-async-invalidation')!;
      const engine = createCommandEngine({ commands: [command] });
      engine.select(0);
      engine.select(0);
      await loadOptions();
      engine.select(1);
      engine.back();
      await loadOptions();
      expect(engine.getSnapshot().active).toBe(1);
      engine.back();
      engine.select(1);
      await loadOptions();
      expect(engine.getSnapshot().items.map(value => value.label)).toEqual(['Shared item', 'Only B']);
      expect(engine.getSnapshot().active).toBe(0);
      engine.select(1);
      expect(engine.getSnapshot().answers).toEqual({ dataset: 'b', item: 'b-only' });
      engine.destroy();
    } finally { vi.useRealTimers(); }
  });

  it.each(['before', 'after'] as const)('keeps the %s final screen open', async timing => {
    vi.useFakeTimers();
    try {
      const record = vi.fn();
      const command = createCommands(record, false).find(value => value.id === `test-async-invalidation-${timing}`)!;
      const engine = createCommandEngine({ commands: [command] });
      engine.select(0);
      engine.select(0);
      await loadOptions();
      engine.select(0);
      engine.select(0);
      await Promise.resolve();
      expect(engine.getSnapshot().phase).toBe('final');
      expect(engine.getSnapshot().closed).toBe(false);
      expect(record).toHaveBeenCalledTimes(timing === 'before' ? 0 : 1);
      if (timing === 'before') await engine.execute();
      expect(record).toHaveBeenCalledOnce();
      expect(engine.getSnapshot().closed).toBe(false);
      engine.destroy();
    } finally { vi.useRealTimers(); }
  });
});
