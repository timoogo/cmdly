import { describe, it, expect, vi } from 'vitest';
import { createCommandEngine, createCommandRegistry, filterByTag } from './core.js';
import type { ContextualCommand } from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cmd(id: string, extra?: Partial<ContextualCommand<undefined, undefined>>) {
  return { id, label: id, run: vi.fn(), ...extra } as ContextualCommand<undefined, undefined>;
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

describe('tags on commands', () => {
  it('commands can carry tags', () => {
    const r = createCommandRegistry();
    r.register(cmd('open', { tags: ['file', 'editor'] }));
    const [c] = r.list();
    expect(c.tags).toEqual(['file', 'editor']);
  });

  it('list returns commands without tags too', () => {
    const r = createCommandRegistry();
    r.register(cmd('open', { tags: ['file'] }));
    r.register(cmd('save'));
    expect(r.list()).toHaveLength(2);
    expect(r.list()[1].tags).toBeUndefined();
  });
});

describe('listByTag', () => {
  it('returns only commands with the given tag', () => {
    const r = createCommandRegistry();
    r.register(cmd('open', { tags: ['file'] }));
    r.register(cmd('save', { tags: ['file', 'editor'] }));
    r.register(cmd('run', { tags: ['exec'] }));
    r.register(cmd('noop'));

    const files = r.listByTag('file');
    expect(files.map(c => c.id)).toEqual(['open', 'save']);
    const execs = r.listByTag('exec');
    expect(execs.map(c => c.id)).toEqual(['run']);
  });

  it('returns empty array when no command matches', () => {
    const r = createCommandRegistry();
    r.register(cmd('open', { tags: ['file'] }));
    expect(r.listByTag('missing')).toEqual([]);
  });

  it('works across mounted namespaces', () => {
    const child = createCommandRegistry();
    child.register(cmd('search', { tags: ['find'] }));
    const root = createCommandRegistry();
    root.register(cmd('open', { tags: ['find'] }));
    root.mount('editor', child);

    const found = root.listByTag('find');
    expect(found.map(c => c.id)).toContain('open');
    expect(found.map(c => c.id)).toContain('editor.search');
  });
});

describe('filterByTag utility', () => {
  it('filters an array by tag', () => {
    const items = [
      cmd('a', { tags: ['x'] }),
      cmd('b', { tags: ['y'] }),
      cmd('c', { tags: ['x', 'y'] }),
      cmd('d'),
    ];
    expect(filterByTag(items, 'x').map(c => c.id)).toEqual(['a', 'c']);
  });

  it('returns empty for no match', () => {
    expect(filterByTag([cmd('a', { tags: ['y'] })], 'x')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// register("*", ...) — primary wildcard API
// ---------------------------------------------------------------------------

describe('register("*", command)', () => {
  it('appears in list() at root level', () => {
    const r = createCommandRegistry();
    r.register('*', cmd('help'));
    expect(r.list().map(c => c.id)).toContain('help');
  });

  it('appears under every mounted namespace', () => {
    const r = createCommandRegistry();
    const child1 = createCommandRegistry();
    const child2 = createCommandRegistry();
    child1.register(cmd('a'));
    child2.register(cmd('b'));
    r.mount('ns1', child1);
    r.mount('ns2', child2);

    r.register('*', cmd('help'));

    const ids = r.list().map(c => c.id);
    expect(ids).toContain('help');
    expect(ids).toContain('ns1.help');
    expect(ids).toContain('ns2.help');
  });

  it('appears under namespaces mounted AFTER the wildcard call', () => {
    const r = createCommandRegistry();
    r.register('*', cmd('help'));

    const child = createCommandRegistry();
    child.register(cmd('a'));
    r.mount('ns', child);

    const ids = r.list().map(c => c.id);
    expect(ids).toContain('help');
    expect(ids).toContain('ns.help');
  });

  it('returns an unregister function that removes from all namespaces', () => {
    const r = createCommandRegistry();
    const child = createCommandRegistry();
    child.register(cmd('a'));
    r.mount('ns', child);

    const unregister = r.register('*', cmd('help'));
    expect(r.list().map(c => c.id)).toContain('ns.help');

    unregister();
    expect(r.list().map(c => c.id)).not.toContain('help');
    expect(r.list().map(c => c.id)).not.toContain('ns.help');
  });

  it('publishes to subscribers', () => {
    const r = createCommandRegistry();
    const listener = vi.fn();
    r.subscribe(listener);
    r.register('*', cmd('help'));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('publishes on unregister', () => {
    const r = createCommandRegistry();
    const listener = vi.fn();
    const unregister = r.register('*', cmd('help'));
    r.subscribe(listener);
    unregister();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// register("*", ...) with skipRegistries — registry namespace exclusion
// ---------------------------------------------------------------------------

describe('register("*", command, { skipRegistries })', () => {
  it('skips the listed namespace ids', () => {
    const r = createCommandRegistry();
    const admin = createCommandRegistry();
    const user = createCommandRegistry();
    admin.register(cmd('a'));
    user.register(cmd('b'));
    r.mount('admin', admin);
    r.mount('user', user);

    r.register('*', cmd('help'), { skipRegistries: ['admin'] });

    const ids = r.list().map(c => c.id);
    expect(ids).toContain('help');
    expect(ids).toContain('user.help');
    expect(ids).not.toContain('admin.help');
  });

  it('supports multiple skipped registries', () => {
    const r = createCommandRegistry();
    const ns1 = createCommandRegistry();
    const ns2 = createCommandRegistry();
    const ns3 = createCommandRegistry();
    r.mount('ns1', ns1);
    r.mount('ns2', ns2);
    r.mount('ns3', ns3);

    r.register('*', cmd('help'), { skipRegistries: ['ns1', 'ns2'] });

    const ids = r.list().map(c => c.id);
    expect(ids).not.toContain('ns1.help');
    expect(ids).not.toContain('ns2.help');
    expect(ids).toContain('ns3.help');
    expect(ids).toContain('help');
  });

  it('skipRegistries applies to late-mounted namespaces too', () => {
    const r = createCommandRegistry();
    r.register('*', cmd('help'), { skipRegistries: ['secret'] });

    const secret = createCommandRegistry();
    const pub = createCommandRegistry();
    r.mount('secret', secret);
    r.mount('pub', pub);

    const ids = r.list().map(c => c.id);
    expect(ids).not.toContain('secret.help');
    expect(ids).toContain('pub.help');
  });

  it('skipRegistries does NOT block explicit register() in the skipped registry', () => {
    // skipRegistries only controls global injection — it is not a command-id block
    const r = createCommandRegistry();
    const admin = createCommandRegistry();
    r.mount('admin', admin);
    r.register('*', cmd('help'), { skipRegistries: ['admin'] });

    // The admin registry can still explicitly register its own 'help' command
    expect(() => admin.register(cmd('help'))).not.toThrow();
    expect(r.list().map(c => c.id)).toContain('admin.help');
  });
});

// ---------------------------------------------------------------------------
// registerGlobal — alias for register("*", ...)
// ---------------------------------------------------------------------------

describe('registerGlobal (alias)', () => {
  it('is an alias for register("*", ...)', () => {
    const r = createCommandRegistry();
    const child = createCommandRegistry();
    r.mount('ns', child);

    r.registerGlobal(cmd('help'));

    const ids = r.list().map(c => c.id);
    expect(ids).toContain('help');
    expect(ids).toContain('ns.help');
  });

  it('skipRegistries option works via alias', () => {
    const r = createCommandRegistry();
    const admin = createCommandRegistry();
    const user = createCommandRegistry();
    r.mount('admin', admin);
    r.mount('user', user);

    r.registerGlobal(cmd('help'), { skipRegistries: ['admin'] });

    const ids = r.list().map(c => c.id);
    expect(ids).not.toContain('admin.help');
    expect(ids).toContain('user.help');
  });
});

// ---------------------------------------------------------------------------
// Concept separation: skipRegistries vs exclude()
// ---------------------------------------------------------------------------

describe('concept separation: registry namespaces vs command ids', () => {
  it('skipRegistries blocks namespace injection, not the command id itself', () => {
    const r = createCommandRegistry();
    const admin = createCommandRegistry();
    r.mount('admin', admin);
    // Global help skips the 'admin' namespace injection
    r.register('*', cmd('help'), { skipRegistries: ['admin'] });
    // The root still has 'help'
    expect(r.list().map(c => c.id)).toContain('help');
    // admin does NOT get the global injection
    expect(r.list().map(c => c.id)).not.toContain('admin.help');
    // But admin can register its own 'help' — the skip is NOT a command-id ban
    expect(() => admin.register(cmd('help'))).not.toThrow();
    expect(r.list().map(c => c.id)).toContain('admin.help');
  });

  it('exclude() bans a command id, not a namespace', () => {
    const r = createCommandRegistry();
    const admin = createCommandRegistry();
    r.mount('admin', admin);
    // Ban the command id 'secret-cmd' from the root registry
    r.exclude(['secret-cmd']);
    // Cannot register 'secret-cmd' at root
    expect(() => r.register(cmd('secret-cmd'))).toThrow(/excluded/);
    // But the admin sub-registry is unaffected — it can register 'secret-cmd'
    expect(() => admin.register(cmd('secret-cmd'))).not.toThrow();
    expect(r.list().map(c => c.id)).toContain('admin.secret-cmd');
  });

  it('exclude() on a command id does not prevent namespace injection of a global with a different id', () => {
    const r = createCommandRegistry();
    const admin = createCommandRegistry();
    r.mount('admin', admin);
    r.exclude(['forbidden']);          // bans id 'forbidden' from root
    r.register('*', cmd('allowed')); // global with a different id
    // The global still injects into admin
    expect(r.list().map(c => c.id)).toContain('admin.allowed');
  });

  it('child.exclude() on a command id blocks global injection of that specific id into the child', () => {
    const r = createCommandRegistry();
    const admin = createCommandRegistry();
    admin.exclude(['help']); // admin blocks command id 'help' for itself
    r.mount('admin', admin);
    r.register('*', cmd('help')); // global

    // Root still has 'help'
    expect(r.list().map(c => c.id)).toContain('help');
    // Admin blocked command id 'help' — global injection is suppressed
    expect(r.list().map(c => c.id)).not.toContain('admin.help');
    // And admin cannot explicitly register 'help' either
    expect(() => admin.register(cmd('help'))).toThrow(/excluded/);
  });
});

describe('exclude()', () => {
  it('prevents registering an excluded id', () => {
    const r = createCommandRegistry();
    r.exclude(['admin']);
    expect(() => r.register(cmd('admin'))).toThrow(/excluded/);
  });

  it('error message names the id', () => {
    const r = createCommandRegistry();
    r.exclude(['admin']);
    expect(() => r.register(cmd('admin'))).toThrow('admin');
  });

  it('retroactively removes an existing entry', () => {
    const r = createCommandRegistry();
    r.register(cmd('admin'));
    expect(r.list().map(c => c.id)).toContain('admin');
    r.exclude(['admin']);
    expect(r.list().map(c => c.id)).not.toContain('admin');
  });

  it('exclusions are prioritized over later explicit register calls', () => {
    const r = createCommandRegistry();
    r.exclude(['admin']);
    expect(() => r.register(cmd('admin'))).toThrow();
  });

  it('exclusion blocks registerMany too', () => {
    const r = createCommandRegistry();
    r.exclude(['secret']);
    expect(() => r.registerMany([cmd('open'), cmd('secret')])).toThrow(/excluded/);
  });

  it('excluding a non-existent id still publishes', () => {
    const r = createCommandRegistry();
    const listener = vi.fn();
    r.subscribe(listener);
    r.exclude(['ghost']);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('idempotent: excluding the same id twice does not double-publish', () => {
    const r = createCommandRegistry();
    const listener = vi.fn();
    r.subscribe(listener);
    r.exclude(['x']);
    r.exclude(['x']); // already excluded — no change
    // first call publishes once; second call is a no-op
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('blocked id is not injected via registerGlobal either', () => {
    const r = createCommandRegistry();
    r.exclude(['help']); // block 'help' at root level
    r.registerGlobal(cmd('help')); // global with same id
    expect(r.list().map(c => c.id)).not.toContain('help');
  });

  it('child registry can independently exclude a global id', () => {
    const r = createCommandRegistry();
    const child = createCommandRegistry();
    child.exclude(['help']); // child refuses 'help'
    r.mount('ns', child);
    r.registerGlobal(cmd('help'));

    const ids = r.list().map(c => c.id);
    expect(ids).toContain('help');   // root level: fine
    expect(ids).not.toContain('ns.help'); // child excluded it
  });
});

// ---------------------------------------------------------------------------
// Late-created registry / dynamic mount
// ---------------------------------------------------------------------------

describe('late mount & globals', () => {
  it('a global registered before mount appears after mount', () => {
    const r = createCommandRegistry();
    r.registerGlobal(cmd('help'));
    const child = createCommandRegistry();
    r.mount('ns', child);
    expect(r.list().map(c => c.id)).toContain('ns.help');
  });

  it('unmounting a child removes its global projections', () => {
    const r = createCommandRegistry();
    const child = createCommandRegistry();
    const unmount = r.mount('ns', child);
    r.registerGlobal(cmd('help'));
    expect(r.list().map(c => c.id)).toContain('ns.help');
    unmount();
    expect(r.list().map(c => c.id)).not.toContain('ns.help');
  });

  it('subscriber on root is notified when child is mounted after registerGlobal', () => {
    const r = createCommandRegistry();
    r.registerGlobal(cmd('help'));
    const listener = vi.fn();
    r.subscribe(listener);
    const child = createCommandRegistry();
    r.mount('ns', child);
    expect(listener).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Conflicts and edge cases
// ---------------------------------------------------------------------------

describe('conflicts and edge cases', () => {
  it('registerGlobal with same id as existing entry does not throw (coexists)', () => {
    const r = createCommandRegistry();
    r.register(cmd('help'));
    // global with same id — produces duplicate in list(), which is a known trade-off
    expect(() => r.registerGlobal(cmd('help'))).not.toThrow();
  });

  it('two globals with same id both appear', () => {
    const r = createCommandRegistry();
    r.registerGlobal(cmd('help'));
    r.registerGlobal(cmd('help'));
    const helps = r.list().filter(c => c.id === 'help');
    expect(helps).toHaveLength(2);
  });

  it('register with valid id after unrelated exclude still works', () => {
    const r = createCommandRegistry();
    r.exclude(['admin']);
    r.register(cmd('help'));
    expect(r.list().map(c => c.id)).toContain('help');
  });

  it('tags on a global command are preserved under namespaces', () => {
    const r = createCommandRegistry();
    const child = createCommandRegistry();
    r.mount('ns', child);
    r.registerGlobal(cmd('help', { tags: ['global'] }));

    const nsHelp = r.list().find(c => c.id === 'ns.help');
    expect(nsHelp?.tags).toEqual(['global']);
  });

  it('tags on global command preserved at root level', () => {
    const r = createCommandRegistry();
    r.registerGlobal(cmd('help', { tags: ['global'] }));
    const h = r.list().find(c => c.id === 'help');
    expect(h?.tags).toEqual(['global']);
  });

  it('listByTag finds globals across namespaces', () => {
    const r = createCommandRegistry();
    const child = createCommandRegistry();
    r.mount('ns', child);
    r.registerGlobal(cmd('help', { tags: ['everywhere'] }));

    const found = r.listByTag('everywhere');
    expect(found.map(c => c.id)).toContain('help');
    expect(found.map(c => c.id)).toContain('ns.help');
  });
});

it("resolves global commands through mounted registries", () => {
  const root = createCommandRegistry();
  const publications = createCommandRegistry();
  const agents = createCommandRegistry();

  root.mount("publications", publications);
  root.mount("xiagents", agents);

  root.register("*", {
    id: "test-cmdly",
    label: "Test Cmdly",
    tags: ["test", "global"],
    run: () => {},
  });

  for (const command of root.list()) {
    const resolved = root.resolve(command.id);

    expect(resolved).toBeDefined();
    expect(resolved?.isValid()).toBe(true);
  }

  expect(() =>
    createCommandEngine({ registry: root })
  ).not.toThrow();
});