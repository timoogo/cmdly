import { describe, it, expect, vi } from 'vitest';
import { createCommandRegistry, createCommandEngine, filterByTag } from './core.js';
import type { ContextualCommand } from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cmd(id: string, extra?: Partial<ContextualCommand<undefined, undefined>>) {
  return { id, label: id, run: vi.fn(), ...extra } as ContextualCommand<undefined, undefined>;
}

function ids(engine: { getSnapshot: () => { items: Array<{ id?: string; value?: string }> } }) {
  return engine.getSnapshot().items.map(item => item.id ?? item.value ?? '');
}

// ---------------------------------------------------------------------------
// unique mode (default)
// ---------------------------------------------------------------------------

describe('globalDisplay: "unique" (default)', () => {
  it('shows each global command exactly once', () => {
    const r = createCommandRegistry();
    const ns1 = createCommandRegistry();
    const ns2 = createCommandRegistry();
    r.mount('ns1', ns1);
    r.mount('ns2', ns2);
    r.register('*', cmd('help'));

    const engine = createCommandEngine({ registry: r });
    const palette = ids(engine);

    // 'help' once at root; ns1.help and ns2.help suppressed
    expect(palette.filter(id => id === 'help' || id.endsWith('.help'))).toHaveLength(1);
    expect(palette).toContain('help');
  });

  it('"unique" is the default when globalDisplay is omitted', () => {
    const r = createCommandRegistry();
    const child = createCommandRegistry();
    r.mount('ns', child);
    r.register('*', cmd('help'));

    const engine = createCommandEngine({ registry: r });
    expect(ids(engine).filter(id => id === 'help' || id.endsWith('.help'))).toHaveLength(1);
  });

  it('local commands are never deduplicated', () => {
    const r = createCommandRegistry();
    const ns = createCommandRegistry();
    ns.register(cmd('save'));
    r.register(cmd('open'));
    r.mount('ns', ns);
    r.register('*', cmd('help'));

    const engine = createCommandEngine({ registry: r });
    const palette = ids(engine);

    expect(palette).toContain('open');
    expect(palette).toContain('ns.save');
    // help appears once
    expect(palette.filter(id => id === 'help' || id.endsWith('.help'))).toHaveLength(1);
  });

  it('without activeRegistry, global resolves at root', () => {
    const r = createCommandRegistry();
    const ns = createCommandRegistry();
    r.mount('ns', ns);
    r.register('*', cmd('help'));

    const engine = createCommandEngine({ registry: r });
    expect(ids(engine)).toContain('help');
    expect(ids(engine)).not.toContain('ns.help');
  });

  it('with activeRegistry, global resolves through that namespace', () => {
    const r = createCommandRegistry();
    const ns = createCommandRegistry();
    r.mount('ns', ns);
    r.register('*', cmd('help'));

    const engine = createCommandEngine({ registry: r, activeRegistry: 'ns' });
    expect(ids(engine)).toContain('ns.help');
    expect(ids(engine)).not.toContain('help');
  });

  it('activeRegistry that has no matching global falls back to root', () => {
    const r = createCommandRegistry();
    const ns1 = createCommandRegistry();
    const ns2 = createCommandRegistry();
    r.mount('ns1', ns1);
    r.mount('ns2', ns2);
    // global skips ns1, so ns1.help does not exist
    r.register('*', cmd('help'), { skipRegistries: ['ns1'] });

    // activeRegistry ns1 has no help → falls back to root
    const engine = createCommandEngine({ registry: r, activeRegistry: 'ns1' });
    expect(ids(engine)).toContain('help');
    expect(ids(engine)).not.toContain('ns1.help');
  });

  it('multiple globals each appear once', () => {
    const r = createCommandRegistry();
    const ns = createCommandRegistry();
    r.mount('ns', ns);
    r.register('*', cmd('help'));
    r.register('*', cmd('quit'));

    const engine = createCommandEngine({ registry: r });
    const palette = ids(engine);

    expect(palette.filter(id => id === 'help' || id.endsWith('.help'))).toHaveLength(1);
    expect(palette.filter(id => id === 'quit' || id.endsWith('.quit'))).toHaveLength(1);
  });

  it('skipRegistries is respected — skipped namespace never appears even as sole candidate', () => {
    const r = createCommandRegistry();
    const admin = createCommandRegistry();
    const user = createCommandRegistry();
    r.mount('admin', admin);
    r.mount('user', user);
    r.register('*', cmd('help'), { skipRegistries: ['admin'] });

    const engine = createCommandEngine({ registry: r });
    expect(ids(engine)).not.toContain('admin.help');
    // root-level help is present
    expect(ids(engine)).toContain('help');
  });
});

// ---------------------------------------------------------------------------
// per-registry mode
// ---------------------------------------------------------------------------

describe('globalDisplay: "per-registry"', () => {
  it('shows the global in every namespace', () => {
    const r = createCommandRegistry();
    const ns1 = createCommandRegistry();
    const ns2 = createCommandRegistry();
    r.mount('ns1', ns1);
    r.mount('ns2', ns2);
    r.register('*', cmd('help'));

    const engine = createCommandEngine({ registry: r, globalDisplay: 'per-registry' });
    const palette = ids(engine);

    expect(palette).toContain('help');
    expect(palette).toContain('ns1.help');
    expect(palette).toContain('ns2.help');
  });

  it('skipRegistries still suppresses excluded namespaces', () => {
    const r = createCommandRegistry();
    const admin = createCommandRegistry();
    const user = createCommandRegistry();
    r.mount('admin', admin);
    r.mount('user', user);
    r.register('*', cmd('help'), { skipRegistries: ['admin'] });

    const engine = createCommandEngine({ registry: r, globalDisplay: 'per-registry' });
    const palette = ids(engine);

    expect(palette).toContain('help');
    expect(palette).toContain('user.help');
    expect(palette).not.toContain('admin.help');
  });

  it('local commands appear as-is', () => {
    const r = createCommandRegistry();
    const ns = createCommandRegistry();
    ns.register(cmd('save'));
    r.mount('ns', ns);
    r.register('*', cmd('help'));

    const engine = createCommandEngine({ registry: r, globalDisplay: 'per-registry' });
    const palette = ids(engine);

    expect(palette).toContain('ns.save');
    expect(palette).toContain('help');
    expect(palette).toContain('ns.help');
  });
});

// ---------------------------------------------------------------------------
// activeRegistry without globals
// ---------------------------------------------------------------------------

describe('activeRegistry with no globals', () => {
  it('has no effect when there are no globals', () => {
    const r = createCommandRegistry();
    const ns = createCommandRegistry();
    ns.register(cmd('save'));
    r.register(cmd('open'));
    r.mount('ns', ns);

    const engine = createCommandEngine({ registry: r, activeRegistry: 'ns' });
    const palette = ids(engine);

    expect(palette).toContain('open');
    expect(palette).toContain('ns.save');
  });
});

// ---------------------------------------------------------------------------
// Dynamic changes: mount/unmount, unregister global
// ---------------------------------------------------------------------------

describe('dynamic changes in unique mode', () => {
  it('adding a global after engine creation refreshes correctly', () => {
    const r = createCommandRegistry();
    const ns = createCommandRegistry();
    r.mount('ns', ns);

    const engine = createCommandEngine({ registry: r });
    r.register('*', cmd('help'));
    engine.refreshRegistry();

    const palette = ids(engine);
    expect(palette.filter(id => id === 'help' || id.endsWith('.help'))).toHaveLength(1);
  });

  it('unregistering a global removes it from the palette', () => {
    const r = createCommandRegistry();
    const ns = createCommandRegistry();
    r.mount('ns', ns);

    const engine = createCommandEngine({ registry: r });
    const unregister = r.register('*', cmd('help'));
    engine.refreshRegistry();
    expect(ids(engine)).toContain('help');

    unregister();
    engine.refreshRegistry();
    expect(ids(engine)).not.toContain('help');
    expect(ids(engine)).not.toContain('ns.help');
  });

  it('mounting a new namespace does not break unique deduplication', () => {
    const r = createCommandRegistry();
    r.register('*', cmd('help'));

    const engine = createCommandEngine({ registry: r });
    const ns = createCommandRegistry();
    r.mount('ns', ns);
    engine.refreshRegistry();

    expect(ids(engine).filter(id => id === 'help' || id.endsWith('.help'))).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// exclude() on child — global injection suppressed there, unique mode
// ---------------------------------------------------------------------------

describe('exclude() interaction with globalDisplay', () => {
  it('child exclude() suppresses global in unique mode; root variant used instead', () => {
    const r = createCommandRegistry();
    const ns = createCommandRegistry();
    ns.exclude(['help']); // ns refuses help
    r.mount('ns', ns);
    r.register('*', cmd('help'));

    const engine = createCommandEngine({ registry: r, activeRegistry: 'ns' });
    // ns.help is blocked — falls back to root-level help
    expect(ids(engine)).toContain('help');
    expect(ids(engine)).not.toContain('ns.help');
  });
});

// ---------------------------------------------------------------------------
// isGlobal on ResolvedCommand
// ---------------------------------------------------------------------------

describe('ResolvedCommand.isGlobal', () => {
  it('is false for locally registered commands', () => {
    const r = createCommandRegistry();
    r.register(cmd('open'));
    expect(r.resolve('open')?.isGlobal).toBe(false);
  });

  it('is true for a global at root level', () => {
    const r = createCommandRegistry();
    r.register('*', cmd('help'));
    expect(r.resolve('help')?.isGlobal).toBe(true);
  });

  it('is true for a global injected into a namespace', () => {
    const r = createCommandRegistry();
    const ns = createCommandRegistry();
    r.mount('ns', ns);
    r.register('*', cmd('help'));
    expect(r.resolve('ns.help')?.isGlobal).toBe(true);
  });

  it('is false for a locally registered command in a child registry', () => {
    const r = createCommandRegistry();
    const ns = createCommandRegistry();
    ns.register(cmd('save'));
    r.mount('ns', ns);
    expect(r.resolve('ns.save')?.isGlobal).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// shared / runtime context preserved through unique mode
// ---------------------------------------------------------------------------

describe('shared/runtime context preserved in unique mode', () => {
  it('the winning entry carries the correct shared value', () => {
    const r = createCommandRegistry<{ owner: string }>({ shared: { owner: 'root' } });
    const ns = createCommandRegistry<{ owner: string }>({ shared: { owner: 'ns' } });
    r.mount('ns', ns);
    r.register('*', cmd('help') as unknown as ContextualCommand<{ owner: string }, undefined>);

    // unique mode, activeRegistry = 'ns' → ns.help is the winner
    const engine = createCommandEngine({ registry: r, activeRegistry: 'ns' });
    const helpId = ids(engine).find(id => id === 'ns.help' || id === 'help') ?? '';
    const resolved = r.resolve(helpId);
    // ns owns the help entry when activeRegistry = ns
    expect((resolved?.shared as { owner: string })?.owner).toBe('ns');
  });

  it('without activeRegistry, root shared is used', () => {
    const r = createCommandRegistry<{ owner: string }>({ shared: { owner: 'root' } });
    const ns = createCommandRegistry<{ owner: string }>({ shared: { owner: 'ns' } });
    r.mount('ns', ns);
    r.register('*', cmd('help') as unknown as ContextualCommand<{ owner: string }, undefined>);

    const engine = createCommandEngine({ registry: r }); // no activeRegistry
    const helpId = ids(engine).find(id => id === 'help' || id.endsWith('.help')) ?? '';
    const resolved = r.resolve(helpId);
    expect((resolved?.shared as { owner: string })?.owner).toBe('root');
  });
});

// ---------------------------------------------------------------------------
// filterByTag still works with global commands
// ---------------------------------------------------------------------------

describe('filterByTag with globals', () => {
  it('filters globals by tag across namespaces', () => {
    const r = createCommandRegistry();
    const ns = createCommandRegistry();
    r.mount('ns', ns);
    r.register('*', cmd('help', { tags: ['global'] }));

    const all = r.list();
    const tagged = filterByTag(all, 'global');
    expect(tagged.map(c => c.id)).toContain('help');
    expect(tagged.map(c => c.id)).toContain('ns.help');
  });
});
