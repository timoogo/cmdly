import { describe, expect, it, vi } from 'vitest';
import { createCommandRegistry, type Command } from './core';

const command = (id: string): Command => ({ id, label: id, run: () => {} });
const ids = (registry: ReturnType<typeof createCommandRegistry>) => registry.list().map(item => item.id);

describe('command registry', () => {
  it('registers, retrieves and safely unregisters commands', () => {
    const registry = createCommandRegistry();
    const remove = registry.register(command('one'));
    expect(registry.get('one')?.label).toBe('one');
    remove(); remove();
    const removeNew = registry.register(command('one'));
    remove();
    expect(ids(registry)).toEqual(['one']);
    removeNew();
    expect(registry.get('one')).toBeUndefined();
  });

  it('registers batches atomically and rejects local collisions', () => {
    const registry = createCommandRegistry();
    registry.register(command('existing'));
    expect(() => registry.registerMany([command('new'), command('existing')])).toThrow();
    expect(() => registry.registerMany([command('x'), command('x')])).toThrow();
    expect(ids(registry)).toEqual(['existing']);
    const remove = registry.registerMany([command('a'), command('b')]);
    remove(); remove();
    expect(ids(registry)).toEqual(['existing']);
  });

  it('mounts recursively and unmounts without touching a replacement', () => {
    const root = createCommandRegistry(), child = createCommandRegistry(), leaf = createCommandRegistry();
    leaf.register(command('go'));
    child.mount('leaf', leaf);
    const unmount = root.mount('child', child);
    expect(root.get('child.leaf.go')?.id).toBe('child.leaf.go');
    unmount(); unmount();
    root.mount('child', child);
    unmount();
    expect(ids(root)).toEqual(['child.leaf.go']);
  });

  it('propagates once per ancestor, even through a diamond, and unsubscribes', () => {
    const root = createCommandRegistry(), left = createCommandRegistry(), right = createCommandRegistry(), child = createCommandRegistry();
    root.mount('left', left); root.mount('right', right);
    left.mount('child', child); right.mount('child', child);
    const listener = vi.fn(), childListener = vi.fn();
    const unsubscribe = root.subscribe(listener); child.subscribe(childListener);
    const remove = child.register(command('x'));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(childListener).toHaveBeenCalledTimes(1);
    unsubscribe(); unsubscribe(); remove();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('supports mounting the same child under different namespaces', () => {
    const root = createCommandRegistry(), child = createCommandRegistry();
    child.register(command('x'));
    const a = root.mount('a', child); root.mount('b', child);
    expect(ids(root)).toEqual(['a.x', 'b.x']);
    const listener = vi.fn(); root.subscribe(listener);
    a(); listener.mockClear(); child.register(command('y'));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(ids(root)).toEqual(['b.x', 'b.y']);
  });

  it('rejects cycles, invalid segments and conflicts without changing state', () => {
    const root = createCommandRegistry(), child = createCommandRegistry(), leaf = createCommandRegistry();
    root.mount('child', child); child.mount('leaf', leaf);
    expect(() => root.mount('self', root)).toThrow();
    expect(() => leaf.mount('root', root)).toThrow();
    expect(() => root.mount('', leaf)).toThrow();
    expect(() => root.mount('a.b', leaf)).toThrow();
    expect(() => root.register(command('child'))).toThrow();
    expect(() => child.registerMany([command('ok'), command('a.b')])).toThrow();
    expect(() => child.register(command('  '))).toThrow();
    expect(() => child.mount('leaf', root)).toThrow();
    expect(ids(root)).toEqual([]);
    leaf.register(command('x'));
    expect(ids(root)).toEqual(['child.leaf.x']);
  });

  it('isolates top-level commands and result arrays without mutating inputs', () => {
    const root = createCommandRegistry(), child = createCommandRegistry();
    const original = command('x'); child.register(original); root.mount('ns', child);
    const found = root.get('ns.x')!;
    expect(original.id).toBe('x');
    found.id = 'changed'; found.label = 'changed';
    original.id = 'changed'; original.label = 'changed';
    const list = root.list(); list.pop();
    expect(root.get('ns.x')?.label).toBe('x');
    expect(ids(root)).toEqual(['ns.x']);
  });

  it('keeps insertion order, expanding mounts in place', () => {
    const root = createCommandRegistry(), child = createCommandRegistry();
    root.register(command('first')); const remove = root.register(command('second'));
    child.registerMany([command('a'), command('b')]); root.mount('child', child);
    root.register(command('last')); remove(); root.register(command('second'));
    expect(ids(root)).toEqual(['first', 'child.a', 'child.b', 'last', 'second']);
  });

  it('notifies all listeners after a committed change even when one throws', () => {
    const registry = createCommandRegistry(), listener = vi.fn();
    registry.subscribe(() => { throw new Error('listener'); }); registry.subscribe(listener);
    expect(() => registry.register(command('x'))).toThrow('listener');
    expect(listener).toHaveBeenCalledOnce();
    expect(ids(registry)).toEqual(['x']);
  });
});

describe('registration identity', () => {
  it('captures a local registration without mutating the original', () => {
    const registry = createCommandRegistry(), original = command('create');
    const remove = registry.register(original);
    const resolved = registry.resolve('create')!;
    expect(resolved.qualifiedId).toBe('create');
    expect(resolved.command).toEqual(original);
    expect(resolved.command).not.toBe(original);
    expect(resolved.isValid()).toBe(true);
    resolved.command.label = 'changed';
    expect(registry.get('create')?.label).toBe('create');
    expect(original.label).toBe('create');
    remove(); remove();
    expect(resolved.isValid()).toBe(false);
    registry.register(command('create'));
    expect(resolved.isValid()).toBe(false);
    expect(registry.resolve('create')?.isValid()).toBe(true);
  });

  it('tracks each mount in recursive and alternative paths by identity', () => {
    const root = createCommandRegistry(), middle = createCommandRegistry(), child = createCommandRegistry();
    child.register(command('create'));
    const removeChild = middle.mount('posts', child);
    const removeFirst = root.mount('workspace', middle);
    root.mount('alternate', middle);
    const first = root.resolve('workspace.posts.create')!;
    const alternative = root.resolve('alternate.posts.create')!;
    const local = child.resolve('create')!;
    expect(first.command.id).toBe('workspace.posts.create');
    expect(first.isValid()).toBe(true);
    removeFirst(); removeFirst();
    expect(first.isValid()).toBe(false);
    expect(alternative.isValid()).toBe(true);
    expect(local.isValid()).toBe(true);
    root.mount('workspace', middle);
    expect(first.isValid()).toBe(false);
    expect(root.resolve('workspace.posts.create')?.isValid()).toBe(true);
    removeChild();
    expect(alternative.isValid()).toBe(false);
    expect(local.isValid()).toBe(true);
    middle.mount('posts', child);
    expect(alternative.isValid()).toBe(false);
  });

  it('preserves identity across unrelated changes and rejects invalid paths', () => {
    const root = createCommandRegistry(), child = createCommandRegistry();
    child.register(command('x')); root.mount('child', child);
    const captured = root.resolve('child.x')!;
    const notify = vi.fn(); root.subscribe(notify);
    const remove = root.register(command('other'));
    expect(captured.isValid()).toBe(true);
    remove();
    expect(captured.isValid()).toBe(true);
    expect(notify).toHaveBeenCalledTimes(2);
    expect(root.resolve('')).toBeUndefined();
    expect(root.resolve('child')).toBeUndefined();
    expect(root.resolve('child.x.extra')).toBeUndefined();
    expect(root.resolve('child..x')).toBeUndefined();
    expect(root.list().map(item => item.id)).toEqual(['child.x']);
  });

  it('keeps batches atomic and invalidates each captured registration on cleanup', () => {
    const registry = createCommandRegistry();
    registry.register(command('existing'));
    const existing = registry.resolve('existing')!;
    const listener = vi.fn(); registry.subscribe(listener);
    expect(() => registry.registerMany([command('new'), command('existing')])).toThrow();
    expect(listener).not.toHaveBeenCalled();
    expect(existing.isValid()).toBe(true);
    expect(registry.resolve('new')).toBeUndefined();
    const remove = registry.registerMany([command('a'), command('b')]);
    const a = registry.resolve('a')!, b = registry.resolve('b')!;
    remove(); remove();
    expect(a.isValid()).toBe(false);
    expect(b.isValid()).toBe(false);
    registry.register(command('a'));
    expect(a.isValid()).toBe(false);
    expect(existing.isValid()).toBe(true);
  });

  it('does not interpret nested workflow commands as registry entries', () => {
    const registry = createCommandRegistry();
    registry.register({ id: 'manage', label: 'Manage', commands: [command('archive')] });
    expect(registry.resolve('manage')?.isValid()).toBe(true);
    expect(registry.resolve('manage.archive')).toBeUndefined();
    expect(registry.get('manage')?.commands?.[0].id).toBe('archive');
  });
});
