import { describe, it, expect, vi } from 'vitest';
import { createCommandRegistry, mergeTagCatalogs, filterByTag } from './core.js';
import { CmdlyError, CommandUnavailableError } from './errors.js';
import type { ContextualCommand, TagDefinition } from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cmd(
  id: string,
  extra?: Partial<ContextualCommand<undefined, undefined>>,
): ContextualCommand<undefined, undefined> {
  return { id, label: id, run: vi.fn(), ...extra } as ContextualCommand<undefined, undefined>;
}

// ---------------------------------------------------------------------------
// 1. Tag catalog declaration
// ---------------------------------------------------------------------------

describe('tag catalog declaration', () => {
  it('creates a registry with a typed tag catalog', () => {
    const r = createCommandRegistry({
      tags: {
        search: { label: 'Recherche', color: '#3b82f6', variant: 'soft' as const },
        destructive: { label: 'Danger', color: '#ef4444', variant: 'outline' as const },
      },
    });
    expect(r.tagCatalog).toHaveProperty('search');
    expect(r.tagCatalog).toHaveProperty('destructive');
    expect(r.tagCatalog.search.color).toBe('#3b82f6');
  });

  it('allows all TagDefinition fields', () => {
    const r = createCommandRegistry({
      tags: {
        highlight: {
          label: 'HL',
          color: '#fff',
          className: 'bg-yellow-100',
          variant: 'solid' as const,
          style: { fontWeight: 'bold' },
        },
      },
    });
    expect(r.tagCatalog.highlight.style).toEqual({ fontWeight: 'bold' });
  });

  it('no catalog → tagCatalog is empty', () => {
    const r = createCommandRegistry();
    expect(Object.keys(r.tagCatalog)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Tag validation at registration time
// ---------------------------------------------------------------------------

describe('tag validation', () => {
  it('accepts valid catalog tags', () => {
    const r = createCommandRegistry({ tags: { search: {}, nav: {} } });
    expect(() =>
      r.register({ id: 'find', label: 'Find', tags: ['search'], run: vi.fn() }),
    ).not.toThrow();
  });

  it('throws UNKNOWN_TAG for an undeclared tag', () => {
    const r = createCommandRegistry({ tags: { search: {} } });
    let err: unknown;
    try {
      r.register({ id: 'find', label: 'Find', tags: ['unknown' as 'search'], run: vi.fn() });
    } catch (e) { err = e; }
    expect(err).toBeInstanceOf(CmdlyError);
    expect((err as CmdlyError).code).toBe('UNKNOWN_TAG');
    expect((err as CmdlyError<'UNKNOWN_TAG'>).details.tag).toBe('unknown');
    expect((err as CmdlyError<'UNKNOWN_TAG'>).details.commandId).toBe('find');
  });

  it('throws UNKNOWN_TAG for registerMany with an invalid tag', () => {
    const r = createCommandRegistry({ tags: { a: {} } });
    expect(() =>
      r.registerMany([{ id: 'x', label: 'x', tags: ['b' as 'a'], run: vi.fn() }]),
    ).toThrow(CmdlyError);
  });

  it('throws INVALID_TAG_OVERRIDE for unknown override key', () => {
    const r = createCommandRegistry({ tags: { search: {} } });
    expect(() =>
      r.register({
        id: 'find', label: 'Find', tags: ['search'],
        tagOverrides: { ghost: { color: 'red' } } as unknown as { search: Partial<TagDefinition> },
        run: vi.fn(),
      }),
    ).toThrow(CmdlyError);
  });

  it('no catalog → free-form tags are accepted', () => {
    const r = createCommandRegistry();
    expect(() =>
      r.register({ id: 'x', label: 'x', tags: ['anything', 'goes'], run: vi.fn() }),
    ).not.toThrow();
  });

  it('no catalog → tagOverrides are accepted without validation', () => {
    const r = createCommandRegistry();
    expect(() =>
      r.register({ id: 'x', label: 'x', tagOverrides: { anything: { color: 'red' } }, run: vi.fn() }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 3. Static type checking (compile-time)
// ---------------------------------------------------------------------------

describe('static type checking (compiled assertions)', () => {
  it('valid catalog tag compiles without error', () => {
    const r = createCommandRegistry({ tags: { publish: { label: 'Publish' } } });
    // This should compile — 'publish' is a valid key
    r.register({ id: 'pub', label: 'Publish', tags: ['publish'], run: vi.fn() });
    expect(true).toBe(true);
  });

  it('listByTag accepts catalog keys', () => {
    const r = createCommandRegistry({ tags: { publish: {} } });
    r.register({ id: 'pub', label: 'Pub', tags: ['publish'], run: vi.fn() });
    const results = r.listByTag('publish');
    expect(results).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 4. tagOverrides on commands
// ---------------------------------------------------------------------------

describe('tagOverrides on commands', () => {
  it('resolveTagDefinition returns merged definition (override wins)', () => {
    const r = createCommandRegistry({
      tags: { search: { color: '#3b82f6', label: 'Search' } },
    });
    const command = {
      id: 'find', label: 'Find', tags: ['search'] as ['search'],
      tagOverrides: { search: { color: '#a855f7', className: 'text-purple-500' } },
      run: vi.fn(),
    };
    r.register(command);
    const def = r.resolveTagDefinition('search', command);
    // override color wins
    expect(def.color).toBe('#a855f7');
    // catalog label is preserved
    expect(def.label).toBe('Search');
    // override className is present
    expect(def.className).toBe('text-purple-500');
    expect(def.key).toBe('search');
  });

  it('resolveTagDefinition without override returns catalog definition', () => {
    const r = createCommandRegistry({ tags: { nav: { color: 'green', label: 'Nav' } } });
    const def = r.resolveTagDefinition('nav');
    expect(def.color).toBe('green');
    expect(def.label).toBe('Nav');
    expect(def.key).toBe('nav');
  });

  it('resolveTagDefinition returns empty for unknown tag in free-form registry', () => {
    const r = createCommandRegistry();
    const def = r.resolveTagDefinition('anything');
    expect(def.key).toBe('anything');
    expect(def.color).toBeUndefined();
  });

  it('command overrides do not mutate the catalog definition', () => {
    const r = createCommandRegistry({ tags: { search: { color: '#blue' } } });
    const command = {
      id: 'x', label: 'x', tags: ['search'] as ['search'],
      tagOverrides: { search: { color: 'red' } },
      run: vi.fn(),
    };
    r.resolveTagDefinition('search', command);
    // Catalog must not be mutated
    expect(r.tagCatalog.search.color).toBe('#blue');
  });
});

// ---------------------------------------------------------------------------
// 5. Tag catalog inheritance
// ---------------------------------------------------------------------------

describe('tag catalog inheritance', () => {
  it('child inherits parent tags after mount', () => {
    const root = createCommandRegistry({ tags: { nav: { color: 'green' }, search: { color: 'blue' } } });
    const child = createCommandRegistry({ tags: { destructive: { color: 'red' } } });
    root.mount('child', child);

    expect(child.tagCatalog).toHaveProperty('nav');
    expect(child.tagCatalog).toHaveProperty('search');
    expect(child.tagCatalog).toHaveProperty('destructive');
  });

  it('child local definition overrides parent', () => {
    const root = createCommandRegistry({ tags: { search: { color: 'blue' } } });
    const child = createCommandRegistry({ tags: { search: { color: 'purple' } } });
    root.mount('child', child);

    expect(child.tagCatalog.search.color).toBe('purple');
  });

  it('after mount, child can register commands with inherited tags', () => {
    const root = createCommandRegistry({ tags: { nav: { color: 'green' } } });
    const child = createCommandRegistry(); // no catalog → TTags=string, any tag accepted
    root.mount('ns', child);

    // 'nav' is now inherited by child at runtime; child accepts any string tag
    expect(() =>
      child.register({ id: 'go', label: 'Go', tags: ['nav'], run: vi.fn() }),
    ).not.toThrow();
  });

  it('unmounting a parent removes inherited tags', () => {
    const root = createCommandRegistry({ tags: { nav: { color: 'green' } } });
    const child = createCommandRegistry({ tags: { local: {} } });
    const unmount = root.mount('ns', child);

    expect(child.tagCatalog).toHaveProperty('nav');
    unmount();
    expect(child.tagCatalog).not.toHaveProperty('nav');
    expect(child.tagCatalog).toHaveProperty('local');
  });

  it('two parents with same tag and identical definitions: no conflict', () => {
    const p1 = createCommandRegistry({ tags: { a: { color: 'blue' } } });
    const p2 = createCommandRegistry({ tags: { a: { color: 'blue' } } });
    const child = createCommandRegistry();
    p1.mount('x', child);
    expect(() => p2.mount('y', child)).not.toThrow();
    expect(child.tagCatalog).toHaveProperty('a');
  });
});

// ---------------------------------------------------------------------------
// 6. Tag conflict detection
// ---------------------------------------------------------------------------

describe('tag conflict detection', () => {
  it('throws TAG_CONFLICT when two parents define the same tag differently', () => {
    const p1 = createCommandRegistry({ tags: { status: { color: 'blue' } } });
    const p2 = createCommandRegistry({ tags: { status: { color: 'red' } } });
    const child = createCommandRegistry();
    p1.mount('a', child);
    let err: unknown;
    try { p2.mount('b', child); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(CmdlyError);
    expect((err as CmdlyError).code).toBe('TAG_CONFLICT');
    expect((err as CmdlyError<'TAG_CONFLICT'>).details.tag).toBe('status');
  });

  it('mount is atomic: conflict leaves registry unmodified', () => {
    const p1 = createCommandRegistry({ tags: { x: { color: 'blue' } } });
    const p2 = createCommandRegistry({ tags: { x: { color: 'red' } } });
    const child = createCommandRegistry();
    p1.mount('a', child);
    // Count entries before the failing mount
    const beforeKeys = Object.keys(child.tagCatalog).slice();
    try { p2.mount('b', child); } catch { /* expected */ }
    // Catalog should be unchanged after the failed mount
    expect(Object.keys(child.tagCatalog)).toEqual(beforeKeys);
  });

  it('local child override resolves the conflict', () => {
    const p1 = createCommandRegistry({ tags: { x: { color: 'blue' } } });
    const p2 = createCommandRegistry({ tags: { x: { color: 'red' } } });
    const child = createCommandRegistry({ tags: { x: { color: 'purple' } } }); // local wins
    p1.mount('a', child);
    expect(() => p2.mount('b', child)).not.toThrow();
    expect(child.tagCatalog.x.color).toBe('purple');
  });

  it('error message names the conflicting tag', () => {
    const p1 = createCommandRegistry({ tags: { env: { color: 'blue' } } });
    const p2 = createCommandRegistry({ tags: { env: { color: 'green' } } });
    const child = createCommandRegistry();
    p1.mount('a', child);
    let err: unknown;
    try { p2.mount('b', child); } catch (e) { err = e; }
    expect((err as Error).message).toContain('env');
  });
});

// ---------------------------------------------------------------------------
// 7. Custom error messages
// ---------------------------------------------------------------------------

describe('custom error messages', () => {
  it('TAG_CONFLICT message is customisable', () => {
    const p1 = createCommandRegistry({ tags: { x: { color: 'blue' } } });
    const p2 = createCommandRegistry({ tags: { x: { color: 'red' } } });
    const child = createCommandRegistry({
      errorMessages: { TAG_CONFLICT: (d) => `Conflit sur "${d.tag}" entre ${d.registries.join(' et ')}.` },
    });
    p1.mount('a', child);
    let err: unknown;
    try { p2.mount('b', child); } catch (e) { err = e; }
    expect((err as Error).message).toMatch(/^Conflit sur/);
    // Code and details are unaffected
    expect((err as CmdlyError).code).toBe('TAG_CONFLICT');
  });

  it('UNKNOWN_TAG message is customisable', () => {
    const r = createCommandRegistry({
      tags: { valid: {} },
      errorMessages: {
        UNKNOWN_TAG: (d: { tag: string; commandId: string; allowedTags: string[] }) => `Tag inconnu : ${d.tag}`,
      },
    });
    let err: unknown;
    try { r.register({ id: 'x', label: 'x', tags: ['bad' as 'valid'], run: vi.fn() }); } catch (e) { err = e; }
    expect((err as Error).message).toBe('Tag inconnu : bad');
    expect((err as CmdlyError).code).toBe('UNKNOWN_TAG');
  });

  it('INVALID_TAG_OVERRIDE message is customisable', () => {
    const r = createCommandRegistry({
      tags: { a: {} },
      errorMessages: {
        INVALID_TAG_OVERRIDE: (d: { tag: string; commandId: string }) => `Override invalide : "${d.tag}" sur "${d.commandId}"`,
      },
    });
    let err: unknown;
    try {
      r.register({
        id: 'cmd', label: 'cmd', tags: ['a'],
        tagOverrides: { z: {} } as unknown as { a: Partial<TagDefinition> },
        run: vi.fn(),
      });
    } catch (e) { err = e; }
    expect((err as Error).message).toMatch(/Override invalide/);
    expect((err as CmdlyError).code).toBe('INVALID_TAG_OVERRIDE');
  });

  it('custom message does not change code or details', () => {
    const r = createCommandRegistry({
      tags: { a: {} },
      errorMessages: { UNKNOWN_TAG: () => 'custom' },
    });
    let err: CmdlyError<'UNKNOWN_TAG'> | undefined;
    try { r.register({ id: 'x', label: 'x', tags: ['b' as 'a'], run: vi.fn() }); } catch (e) { err = e as CmdlyError<'UNKNOWN_TAG'>; }
    expect(err?.code).toBe('UNKNOWN_TAG');
    expect(err?.details.tag).toBe('b');
    expect(err?.message).toBe('custom');
  });
});

// ---------------------------------------------------------------------------
// 8. CmdlyError class
// ---------------------------------------------------------------------------

describe('CmdlyError', () => {
  it('is an instance of Error', () => {
    const r = createCommandRegistry({ tags: { a: {} } });
    let err: unknown;
    try { r.register({ id: 'x', label: 'x', tags: ['z' as 'a'], run: vi.fn() }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(CmdlyError);
  });

  it('has name CmdlyError', () => {
    const r = createCommandRegistry({ tags: { a: {} } });
    let err: unknown;
    try { r.register({ id: 'x', label: 'x', tags: ['z' as 'a'], run: vi.fn() }); } catch (e) { err = e; }
    expect((err as CmdlyError).name).toBe('CmdlyError');
  });

  it('CommandUnavailableError extends CmdlyError', () => {
    const e = new CommandUnavailableError('some.cmd');
    expect(e).toBeInstanceOf(CmdlyError);
    expect(e.code).toBe('COMMAND_UNAVAILABLE');
    expect(e.details.qualifiedId).toBe('some.cmd');
  });

  it('existing code that catches CommandUnavailableError still works', () => {
    const e = new CommandUnavailableError('x');
    expect(e).toBeInstanceOf(CommandUnavailableError);
    expect(e.message).toContain('x');
  });
});

// ---------------------------------------------------------------------------
// 9. mergeTagCatalogs utility
// ---------------------------------------------------------------------------

describe('mergeTagCatalogs', () => {
  it('merges two catalogs right-wins', () => {
    const a = { x: { color: 'blue' }, y: { color: 'green' } };
    const b = { x: { color: 'red' }, z: { color: 'purple' } };
    const merged = mergeTagCatalogs(a, b);
    expect(merged.x.color).toBe('red');
    expect(merged.y.color).toBe('green');
    expect(merged.z.color).toBe('purple');
  });

  it('does not mutate inputs', () => {
    const a = { x: { color: 'blue' } };
    const b = { x: { color: 'red' } };
    mergeTagCatalogs(a, b);
    expect(a.x.color).toBe('blue');
  });
});

// ---------------------------------------------------------------------------
// 10. sourceRegistry on ResolvedCommand
// ---------------------------------------------------------------------------

describe('sourceRegistry on ResolvedCommand', () => {
  it('is empty string for root-level commands', () => {
    const r = createCommandRegistry();
    r.register(cmd('open'));
    expect(r.resolve('open')?.sourceRegistry).toBe('');
  });

  it('is the namespace path for child-level commands', () => {
    const r = createCommandRegistry();
    const child = createCommandRegistry();
    child.register(cmd('save'));
    r.mount('editor', child);
    expect(r.resolve('editor.save')?.sourceRegistry).toBe('editor');
  });

  it('is the full namespace path for deeply nested commands', () => {
    const r = createCommandRegistry();
    const mid = createCommandRegistry();
    const deep = createCommandRegistry();
    deep.register(cmd('act'));
    mid.mount('deep', deep);
    r.mount('mid', mid);
    expect(r.resolve('mid.deep.act')?.sourceRegistry).toBe('mid.deep');
  });
});

// ---------------------------------------------------------------------------
// 11. tagCatalog on ResolvedCommand
// ---------------------------------------------------------------------------

describe('tagCatalog on ResolvedCommand', () => {
  it('carries the effective catalog of the resolving registry', () => {
    const r = createCommandRegistry({ tags: { nav: { color: 'green' } } });
    r.register({ id: 'go', label: 'go', run: vi.fn() });
    const resolved = r.resolve('go');
    expect(resolved?.tagCatalog).toHaveProperty('nav');
  });

  it('child resolved command carries merged catalog including parent tags', () => {
    const root = createCommandRegistry({ tags: { nav: { color: 'green' } } });
    const child = createCommandRegistry({ tags: { local: { color: 'red' } } });
    child.register({ id: 'act', label: 'act', tags: ['local'], run: vi.fn() });
    root.mount('ns', child);
    const resolved = root.resolve('ns.act');
    expect(resolved?.tagCatalog).toHaveProperty('nav');
    expect(resolved?.tagCatalog).toHaveProperty('local');
  });
});

// ---------------------------------------------------------------------------
// 12. Dynamic mount/unmount with tag inheritance
// ---------------------------------------------------------------------------

describe('dynamic tag inheritance changes', () => {
  it('catalog change is visible after mount (parent listener fires)', () => {
    const root = createCommandRegistry({ tags: { nav: {} } });
    const child = createCommandRegistry();
    const listener = vi.fn();
    root.subscribe(listener); // subscriber on root, which publishes on mount
    root.mount('ns', child);
    expect(listener).toHaveBeenCalled();
  });

  it('after unmount, previously inherited tags are gone', () => {
    const root = createCommandRegistry({ tags: { nav: { color: 'green' } } });
    const child = createCommandRegistry({ tags: { local: {} } });
    const unmount = root.mount('ns', child);
    unmount();
    expect(child.tagCatalog).not.toHaveProperty('nav');
    expect(child.tagCatalog).toHaveProperty('local');
  });
});

// ---------------------------------------------------------------------------
// 13. listByTag with catalog
// ---------------------------------------------------------------------------

describe('listByTag with catalog', () => {
  it('returns commands with the given catalog tag', () => {
    const r = createCommandRegistry({ tags: { search: {}, nav: {} } });
    r.register({ id: 'find', label: 'Find', tags: ['search'], run: vi.fn() });
    r.register({ id: 'go', label: 'Go', tags: ['nav'], run: vi.fn() });
    r.register({ id: 'noop', label: 'Noop', run: vi.fn() });

    expect(r.listByTag('search').map(c => c.id)).toEqual(['find']);
    expect(r.listByTag('nav').map(c => c.id)).toEqual(['go']);
  });

  it('free-form registry: listByTag still works', () => {
    const r = createCommandRegistry();
    r.register({ id: 'a', label: 'a', tags: ['x'], run: vi.fn() });
    r.register({ id: 'b', label: 'b', tags: ['y'], run: vi.fn() });
    expect(r.listByTag('x').map(c => c.id)).toEqual(['a']);
  });
});

// ---------------------------------------------------------------------------
// 14. Global commands with tag validation
// ---------------------------------------------------------------------------

describe('global commands and tags', () => {
  it('registerGlobal validates tags', () => {
    const r = createCommandRegistry({ tags: { a: {} } });
    expect(() =>
      r.register('*', { id: 'help', label: 'Help', tags: ['z' as 'a'], run: vi.fn() }),
    ).toThrow(CmdlyError);
  });

  it('global commands with valid tags are accepted', () => {
    const r = createCommandRegistry({ tags: { global: {} } });
    expect(() =>
      r.register('*', { id: 'help', label: 'Help', tags: ['global'], run: vi.fn() }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 15. filterByTag utility (unchanged behaviour)
// ---------------------------------------------------------------------------

describe('filterByTag utility', () => {
  it('still works with or without catalog', () => {
    const items = [
      { id: 'a', tags: ['x'] },
      { id: 'b', tags: ['y'] },
      { id: 'c', tags: ['x', 'y'] },
      { id: 'd' },
    ];
    expect(filterByTag(items, 'x').map(i => i.id)).toEqual(['a', 'c']);
  });
});

// ---------------------------------------------------------------------------
// 16. Backward compatibility: existing tests still compile with string tags
// ---------------------------------------------------------------------------

describe('backward compatibility', () => {
  it('registry without catalog accepts string[] tags on commands', () => {
    const r = createCommandRegistry();
    // tags: string[] — no catalog, any string accepted
    expect(() =>
      r.register({ id: 'x', label: 'x', tags: ['anything', 'whatever'], run: vi.fn() }),
    ).not.toThrow();
  });

  it('existing shared/runtime generics are unaffected', () => {
    const r = createCommandRegistry<{ userId: string }>({ shared: { userId: '42' } });
    r.register({ id: 'x', label: 'x', run: (_a, ctx) => ctx.shared.userId, tags: ['free'] });
    expect(r.resolve('x')?.shared).toEqual({ userId: '42' });
  });
});
