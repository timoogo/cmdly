import { describe, expect, it } from 'vitest';
import { createCommandRegistry } from './core.js';
import type { CommandRegistry } from './types.js';

describe('registry option types', () => {
  it('infers catalogs and preserves runtime requirements', () => {
    const errorMessages = { TAG_CONFLICT: ({ tag }: { tag: string }) => `Conflict: ${tag}` };
    const messagesOnly = createCommandRegistry({ errorMessages: { TAG_CONFLICT: ({ tag }) => `Conflit sur le tag ${tag}` } });
    const tagsOnly = createCommandRegistry({ tags: { search: {}, nav: {} } });
    const both = createCommandRegistry({ tags: { search: {}, nav: {} }, errorMessages });
    const required = createCommandRegistry<{ name: string }, { userId: string }>({ shared: { name: 'a' }, runtimeRequired: true, errorMessages });
    const optional = createCommandRegistry<{ name: string }, { userId: string } | undefined>({ shared: { name: 'a' }, errorMessages });
    const legacy = createCommandRegistry();
    const shared = createCommandRegistry({ shared: { name: 'a' } });
    const taggedRequired = createCommandRegistry<{ name: string }, { userId: string }, 'search'>({ shared: { name: 'a' }, runtimeRequired: true, tags: { search: {} }, errorMessages });
    const checkMessages: CommandRegistry<undefined, undefined, false, string> = messagesOnly;
    const checkTags: CommandRegistry<undefined, undefined, false, 'search' | 'nav'> = tagsOnly;
    const checkBoth: CommandRegistry<undefined, undefined, false, 'search' | 'nav'> = both;
    const checkRequired: CommandRegistry<{ name: string }, { userId: string }, true> = required;
    const checkOptional: CommandRegistry<{ name: string }, { userId: string } | undefined, false> = optional;
    void [checkMessages, checkTags, checkBoth, checkRequired, checkOptional, legacy, shared, taggedRequired];
    if (false) {
      // @ts-expect-error catalog keys must remain restricted
      both.register({ id: 'a', label: 'A', tags: ['unknown'], run: () => {} });
      // @ts-expect-error undefined cannot be required
      createCommandRegistry<{ name: string }, undefined>({ shared: { name: 'a' }, runtimeRequired: true, errorMessages });
    }
    expect(messagesOnly.runtimeRequired).toBe(false);
  });
});
