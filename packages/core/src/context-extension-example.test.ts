import { describe, expect, it, vi } from 'vitest';
import { createCommandEngine, createCommandRegistry } from '@cmdly/core';

describe('documented contextual workflow', () => {
  it('carries one session through predicates, options, confirmation and execution', async () => {
    type Runtime = { userId: string };
    type Shared = {
      canPublish: (userId: string) => boolean;
      categories: (userId: string) => Promise<{ value: string; label: string }[]>;
      publish: (category: string, visibility: string, userId: string) => void;
    };
    const publish = vi.fn();
    const shared: Shared = {
      canPublish: userId => userId.length > 0,
      categories: async () => [{ value: 'news', label: 'News' }],
      publish,
    };
    const registry = createCommandRegistry<Shared, Runtime>({ shared, runtimeRequired: true });
    registry.register({
      id: 'publish', label: 'Publish',
      when: (_answers, { shared, runtime }) => shared.canPublish(runtime.userId),
      steps: [
        { id: 'category', label: 'Category', options: (_answers, { shared, runtime }) => shared.categories(runtime.userId) },
        { id: 'visibility', label: 'Visibility', when: (_answers, { runtime }) => runtime.userId !== '', options: [{ value: 'public', label: 'Public' }] },
      ],
      finalStep: {
        timing: 'before', closeOnComplete: false,
        when: (_answers, { shared, runtime }) => shared.canPublish(runtime.userId),
        render: (final, { runtime }) => `${runtime.userId}: ${final.summary.length} answers`,
      },
      run: (answers, { shared, runtime }) => shared.publish(answers.category, answers.visibility, runtime.userId),
    });
    const provider = vi.fn(async () => ({ userId: 'user-1' }));
    const executed = vi.fn();
    const engine = createCommandEngine({
      registry,
      runtime: provider,
      callbacks: {
        onExecute: (_command, _answers, context) => executed(context?.runtime.userId),
        onError: (_error, _snapshot, context) => { context?.runtime.userId; },
      },
      strategies: { closeOnComplete: (_command, _answers, _final, context) => context?.runtime.userId === '' },
      plugins: [{ setup(pluginEngine) {
        return pluginEngine.subscribe(() => {
          const context = pluginEngine.getSnapshot().context;
          if (context) context.runtime.userId;
        });
      } }],
    });
    await vi.waitFor(() => expect(engine.getSnapshot().items).toHaveLength(1));
    engine.select(0);
    await vi.waitFor(() => expect(engine.getSnapshot().items).toHaveLength(1));
    engine.select(0);
    engine.select(0);
    expect(engine.getSnapshot().phase).toBe('final');
    await engine.execute();
    expect(publish).toHaveBeenCalledWith('news', 'public', 'user-1');
    expect(executed).toHaveBeenCalledWith('user-1');
    expect(provider).toHaveBeenCalledOnce();
    engine.destroy();
  });
});
