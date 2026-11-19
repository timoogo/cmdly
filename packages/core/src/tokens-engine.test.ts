import { describe, expect, it, vi } from 'vitest';
import { CmdlyError, createCommandEngine, createCommandRegistry } from '@cmdly/core';
import type { Command, Token, TokenMatchResult, TokenType } from '@cmdly/core';

const deferred = <T>() => { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; };
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const statuses = (tokens: Token[]) => tokens.map(token => `${token.type ?? '?'}:${token.value}:${token.status}`);
const commands = (run = vi.fn()): Command[] => [{ id: 'deploy', label: 'Deploy', run }, { id: 'assign', label: 'Assign', run }];
const user: TokenType = { id: 'user', prefix: '@' };

describe('token recognition in the engine', () => {
  it('searches with the residual text and never filters on tokens', () => {
    const engine = createCommandEngine({ commands: commands(), tokens: { types: [user] } });
    engine.setQuery('@alice');
    expect(engine.getSnapshot().items.map(item => item.label)).toEqual(['Deploy', 'Assign']);
    engine.setQuery('assign @alice');
    const state = engine.getSnapshot();
    expect(state.query).toBe('assign @alice');
    expect(state.text).toBe('assign');
    expect(state.items.map(item => item.label)).toEqual(['Assign']);
    expect(statuses(state.tokens)).toEqual(['user:alice:valid']);
    expect(state.tokens[0]).toMatchObject({ prefix: '@', raw: '@alice', start: 7, end: 13, candidates: ['user'] });
    engine.destroy();
  });

  it('keeps the previous behavior when tokens are not configured', async () => {
    const run = vi.fn();
    const engine = createCommandEngine({ commands: commands(run) });
    engine.setQuery(' Dep ');
    expect(engine.getSnapshot()).toMatchObject({ text: ' Dep ', tokens: [], tokenFeedback: { status: 'idle', pending: [], issues: [] } });
    expect(engine.getSnapshot().items).toEqual([]);
    engine.setQuery('dep');
    engine.select(0);
    await flush();
    expect(run).toHaveBeenCalledWith({});
    expect(run.mock.calls[0]).toHaveLength(1);
  });

  describe('match results', () => {
    const run = (result: () => TokenMatchResult<unknown> | Promise<TokenMatchResult<unknown>>) => {
      const engine = createCommandEngine({ commands: commands(), tokens: { types: [{ id: 'user', prefix: '@', match: result }] } });
      engine.setQuery('@alice');
      return engine;
    };
    it('accepts booleans', () => {
      const valid = run(() => true).getSnapshot().tokens[0];
      expect(valid.status).toBe('valid');
      expect(valid.data).toBeUndefined();
      expect(run(() => false).getSnapshot().tokens[0].status).toBe('invalid');
    });
    it('accepts discriminated objects with typed data or a message', () => {
      expect(run(() => ({ valid: true, data: { id: 7 } })).getSnapshot().tokens[0]).toMatchObject({ status: 'valid', data: { id: 7 } });
      expect(run(() => ({ valid: false, message: 'Unknown user' })).getSnapshot().tokens[0]).toMatchObject({ status: 'invalid', message: 'Unknown user' });
    });
    it('turns unsupported results, throws and rejections into errors', async () => {
      const unsupported = run(() => 'yes' as unknown as boolean).getSnapshot().tokens[0];
      expect(unsupported.status).toBe('error');
      expect(unsupported.error).toBeInstanceOf(CmdlyError);
      expect((unsupported.error as CmdlyError).code).toBe('INVALID_TOKEN_MATCH');
      const failure = new Error('boom');
      expect(run(() => { throw failure; }).getSnapshot().tokens[0]).toMatchObject({ status: 'error', error: failure });
      const rejected = run(() => Promise.reject(failure));
      expect(rejected.getSnapshot().tokens[0].status).toBe('pending');
      await flush();
      expect(rejected.getSnapshot().tokens[0]).toMatchObject({ status: 'error', error: failure });
    });
    it('does not call the matcher for an empty value', () => {
      const match = vi.fn(() => true);
      const engine = createCommandEngine({ commands: commands(), tokens: { types: [{ id: 'user', prefix: '@', match }] } });
      engine.setQuery('@');
      expect(engine.getSnapshot().tokens[0]).toMatchObject({ value: '', status: 'invalid' });
      expect(engine.getSnapshot().tokenFeedback.status).toBe('idle');
      expect(match).not.toHaveBeenCalled();
    });
  });

  it('validates against an optional value registry, case-insensitively', () => {
    const engine = createCommandEngine({ commands: commands(), tokens: { types: [{ id: 'env', prefix: ':', values: [{ value: 'prod', data: { region: 'eu' } }] }] } });
    engine.setQuery(':PROD :dev');
    expect(engine.getSnapshot().tokens.map(token => [token.status, token.data])).toEqual([['valid', { region: 'eu' }], ['invalid', undefined]]);
  });

  describe('async validation lifecycle', () => {
    it('publishes pending then the settled status', async () => {
      const gate = deferred<TokenMatchResult<string>>();
      const engine = createCommandEngine({ commands: commands(), tokens: { types: [{ id: 'user', prefix: '@', match: () => gate.promise }] } });
      const listener = vi.fn(); engine.subscribe(listener);
      engine.setQuery('@alice');
      expect(engine.getSnapshot().tokenFeedback).toMatchObject({ status: 'pending' });
      listener.mockClear();
      gate.resolve({ valid: true, data: 'u1' });
      await flush();
      expect(listener).toHaveBeenCalledTimes(1);
      expect(engine.getSnapshot().tokens[0]).toMatchObject({ status: 'valid', data: 'u1' });
      expect(engine.getSnapshot().tokenFeedback.status).toBe('valid');
    });

    it('aborts and ignores obsolete validations while typing', async () => {
      const calls: { value: string; signal: AbortSignal; gate: ReturnType<typeof deferred<boolean>> }[] = [];
      const engine = createCommandEngine({ commands: commands(), tokens: { types: [{ id: 'user', prefix: '@', match: (value, { signal }) => { const gate = deferred<boolean>(); calls.push({ value, signal, gate }); return gate.promise; } }] } });
      engine.setQuery('@al');
      engine.setQuery('@ali');
      expect(calls.map(call => [call.value, call.signal.aborted])).toEqual([['al', true], ['ali', false]]);
      calls[0].gate.resolve(true);
      await flush();
      expect(statuses(engine.getSnapshot().tokens)).toEqual(['user:ali:pending']);
      calls[1].gate.resolve(false);
      await flush();
      expect(statuses(engine.getSnapshot().tokens)).toEqual(['user:ali:invalid']);
    });

    it('reuses an unchanged token across keystrokes', () => {
      const match = vi.fn(() => new Promise<boolean>(() => {}));
      const engine = createCommandEngine({ commands: commands(), tokens: { types: [{ id: 'user', prefix: '@', match }] } });
      engine.setQuery('@alice');
      const id = engine.getSnapshot().tokens[0].id;
      engine.setQuery('de @alice');
      expect(match).toHaveBeenCalledTimes(1);
      expect(engine.getSnapshot().tokens[0]).toMatchObject({ id, start: 3, end: 9 });
    });

    it('validates repeated tokens independently', () => {
      const match = vi.fn(() => true);
      const engine = createCommandEngine({ commands: commands(), tokens: { types: [{ id: 'user', prefix: '@', match }] } });
      engine.setQuery('@a @a');
      const [first, second] = engine.getSnapshot().tokens;
      expect(first.id).not.toBe(second.id);
      expect(match).toHaveBeenCalledTimes(2);
    });

    it('aborts pending validations on close and destroy', async () => {
      const signals: AbortSignal[] = [];
      const make = () => createCommandEngine({ commands: commands(), tokens: { types: [{ id: 'user', prefix: '@', match: (_, { signal }) => { signals.push(signal); return new Promise<boolean>(() => {}); } }] } });
      const closing = make(); closing.setQuery('@a'); closing.close();
      const destroying = make(); destroying.setQuery('@b'); destroying.destroy();
      expect(signals.map(signal => signal.aborted)).toEqual([true, true]);
      expect(closing.getSnapshot().tokens).toEqual([]);
    });
  });

  describe('dynamic registration', () => {
    it('registers, replaces and unregisters global types and republishes', () => {
      const engine = createCommandEngine({ commands: commands() });
      engine.setQuery('@alice');
      expect(engine.getSnapshot().tokens).toEqual([]);
      const listener = vi.fn(); engine.subscribe(listener);
      const dispose = engine.tokens.register({ id: 'user', prefix: '@', values: [{ value: 'bob' }] });
      expect(listener).toHaveBeenCalled();
      expect(statuses(engine.getSnapshot().tokens)).toEqual(['user:alice:invalid']);
      engine.tokens.setValues('user', [{ value: 'alice' }]);
      expect(statuses(engine.getSnapshot().tokens)).toEqual(['user:alice:valid']);
      const replacement: TokenType = { id: 'user', prefix: '@', match: () => false };
      engine.tokens.register(replacement);
      expect(statuses(engine.getSnapshot().tokens)).toEqual(['user:alice:invalid']);
      dispose(); // stale disposer does not remove the replacement
      expect(engine.tokens.list()).toEqual([replacement]);
      engine.tokens.unregister('user');
      expect(engine.getSnapshot()).toMatchObject({ tokens: [], text: '@alice' });
    });

    it('rejects invalid definitions and setValues on matcher types', () => {
      expect(() => createCommandEngine({ commands: [], tokens: { types: [{ id: 'x', prefix: '' }] } })).toThrow(CmdlyError);
      const engine = createCommandEngine({ commands: [], tokens: { types: [{ id: 'user', prefix: '@', match: () => true }] } });
      expect(() => engine.tokens.setValues('user', [])).toThrow(/match/);
      expect(() => engine.tokens.setValues('missing', [])).toThrow(/unknown token type/);
      expect(() => engine.tokens.register({ id: 'none', prefixMode: 'none' } as TokenType)).toThrow(/detect/);
    });

    it('replaces types and resolver through setOptions', () => {
      const engine = createCommandEngine({ commands: commands(), tokens: { types: [user] } });
      engine.setQuery('#1');
      expect(engine.getSnapshot().tokens).toEqual([]);
      engine.setOptions({ tokens: { types: [{ id: 'issue', prefix: '#' }, { id: 'label', prefix: '#' }], resolve: () => 'issue' } });
      expect(statuses(engine.getSnapshot().tokens)).toEqual(['issue:1:valid']);
    });
  });

  it('marks unresolved collisions ambiguous without calling matchers', () => {
    const match = vi.fn(() => true);
    const types: TokenType[] = [{ id: 'issue', prefix: '#', match }, { id: 'label', prefix: '#', match }];
    const engine = createCommandEngine({ commands: commands(), tokens: { types } });
    engine.setQuery('#12');
    expect(engine.getSnapshot().tokens[0]).toMatchObject({ type: undefined, candidates: ['issue', 'label'], status: 'ambiguous' });
    expect(engine.getSnapshot().tokenFeedback.issues).toHaveLength(1);
    expect(match).not.toHaveBeenCalled();
  });

  describe('scopes', () => {
    const member: TokenType = { id: 'member', prefix: '@', values: [{ value: 'alice' }] };
    const env: TokenType = { id: 'env', prefix: ':' };
    const workflow = (run = vi.fn()): Command[] => [{ id: 'team', label: 'Team', tokens: [env], steps: [{ id: 'who', label: 'Who', tokens: [member], options: [{ value: 'x', label: 'X' }] }], run }];

    it('activates step, command and global types by context, local first', () => {
      const engine = createCommandEngine({ commands: workflow(), tokens: { types: [{ id: 'user', prefix: '@', values: [] }] } });
      engine.setQuery('@alice :prod');
      expect(statuses(engine.getSnapshot().tokens)).toEqual(['user:alice:invalid']);
      engine.setQuery('');
      engine.select(0);
      engine.setQuery('@alice :prod');
      expect(statuses(engine.getSnapshot().tokens)).toEqual(['member:alice:valid', 'env:prod:valid']);
      expect(engine.getSnapshot().tokens[0].step).toBe('who');
    });

    it('activates a group command types in its submenu', () => {
      const engine = createCommandEngine({ commands: [{ id: 'group', label: 'Group', tokens: [env], commands: [{ id: 'leaf', label: 'Leaf', run: () => {} }] }] });
      engine.setQuery(':prod');
      expect(engine.getSnapshot().tokens).toEqual([]);
      engine.setQuery('');
      engine.select(0);
      engine.setQuery(':prod');
      expect(statuses(engine.getSnapshot().tokens)).toEqual(['env:prod:valid']);
      expect(engine.getSnapshot().tokens[0].step).toBeUndefined();
    });

    it('reports the scope kind to the resolver', () => {
      const resolve = vi.fn(() => 'a');
      const engine = createCommandEngine({ commands: [{ id: 'c', label: 'C', steps: [{ id: 's', label: 'S', tokens: [{ id: 'a', prefix: '#' }, { id: 'b', prefix: '#' }], options: [{ value: 'x', label: 'X' }] }], run: () => {} }], tokens: { resolve } });
      engine.select(0);
      engine.setQuery('#1');
      expect(resolve).toHaveBeenCalledWith(expect.objectContaining({ scope: 'step', prefix: '#', value: '1' }));
    });
  });

  describe('captured tokens', () => {
    const steps = (run: Command['run']): Command[] => [{ id: 'move', label: 'Move', steps: [
      { id: 'first', label: 'First', options: [{ value: 'a', label: 'A' }] },
      { id: 'second', label: 'Second', options: [{ value: 'b', label: 'B' }] },
    ], run } as Command];

    it('captures menu and step tokens along the path and hands them to run', async () => {
      const run = vi.fn();
      const engine = createCommandEngine({ commands: steps(run), tokens: { types: [user] } });
      engine.setQuery('@menu');
      engine.select(0);
      expect(engine.getSnapshot()).toMatchObject({ query: '', tokens: [] });
      expect(engine.getSnapshot().tokenFeedback.status).toBe('valid');
      engine.setQuery('@first');
      engine.select(0);
      engine.setQuery('@second');
      engine.select(0);
      await flush();
      const context = run.mock.calls[0][1];
      expect(context.tokens.map((token: Token) => [token.value, token.step])).toEqual([['menu', undefined], ['first', 'first'], ['second', 'second']]);
      expect(await context.settleTokens()).toEqual(context.tokens);
    });

    it('drops tokens captured in a step when going back, and keeps earlier ones', async () => {
      const run = vi.fn();
      const engine = createCommandEngine({ commands: steps(run), tokens: { types: [user] } });
      engine.setQuery('@menu'); engine.select(0);
      engine.setQuery('@first'); engine.select(0);
      engine.back();
      expect(engine.getSnapshot().step?.id).toBe('first');
      expect(engine.getSnapshot().query).toBe('');
      engine.setQuery('@again'); engine.select(0);
      engine.select(0);
      await flush();
      expect(run.mock.calls[0][1].tokens.map((token: Token) => token.value)).toEqual(['menu', 'again']);
    });

    it('drops menu tokens when going back to the menu', async () => {
      const run = vi.fn();
      const engine = createCommandEngine({ commands: steps(run), tokens: { types: [user] } });
      engine.setQuery('@old'); engine.select(0);
      engine.back();
      expect(engine.getSnapshot().phase).toBe('menu');
      expect(engine.getSnapshot().tokenFeedback.status).toBe('idle');
      engine.setQuery('@new'); engine.select(0);
      engine.select(0); engine.select(0);
      await flush();
      expect(run.mock.calls[0][1].tokens.map((token: Token) => token.value)).toEqual(['new']);
    });

    it('keeps pending captured tokens alive across navigation and lets run settle them', async () => {
      const gate = deferred<TokenMatchResult<number>>();
      const signals: AbortSignal[] = [];
      let settled: Token[] = [];
      const run = vi.fn(async (_answers: unknown, context?: { tokens?: Token[]; settleTokens?: () => Promise<Token[]> }) => { expect(context?.tokens?.[0].status).toBe('pending'); settled = await context!.settleTokens!(); });
      const engine = createCommandEngine({ commands: steps(run), tokens: { types: [{ id: 'user', prefix: '@', match: (_, { signal }) => { signals.push(signal); return gate.promise; } }] } });
      engine.setQuery('@slow'); engine.select(0);
      expect(signals[0].aborted).toBe(false);
      expect(engine.getSnapshot().tokenFeedback).toMatchObject({ status: 'pending' });
      engine.select(0); engine.select(0);
      await flush();
      expect(run).toHaveBeenCalledTimes(1); // execution is never blocked by pending tokens
      expect(settled).toEqual([]);
      gate.resolve({ valid: true, data: 42 });
      await vi.waitFor(() => expect(settled.map(token => [token.status, token.data])).toEqual([['valid', 42]]));
    });

    it('settles captured tokens as errors when the session closes', async () => {
      const signals: AbortSignal[] = [];
      const engine = createCommandEngine({ commands: [{ id: 'c', label: 'C', finalStep: { timing: 'before' }, run: () => {} }], tokens: { types: [{ id: 'user', prefix: '@', match: (_, { signal }) => { signals.push(signal); return new Promise<boolean>(() => {}); } }] } });
      engine.setQuery('@slow'); engine.select(0);
      expect(engine.getSnapshot().phase).toBe('final');
      engine.close();
      expect(signals[0].aborted).toBe(true);
    });

    it('does not block execution on invalid, error or ambiguous tokens', async () => {
      const run = vi.fn();
      const engine = createCommandEngine({ commands: [{ id: 'c', label: 'C', run }], tokens: { types: [{ id: 'bad', prefix: '!', match: () => false }, { id: 'boom', prefix: '?', match: () => { throw new Error('x'); } }, { id: 'a', prefix: '#' }, { id: 'b', prefix: '#' }] } });
      engine.setQuery('!x ?y #z');
      engine.select(0);
      await flush();
      expect(run.mock.calls[0][1].tokens.map((token: Token) => token.status)).toEqual(['invalid', 'error', 'ambiguous']);
    });

    it('restores final tokens when navigating forward', async () => {
      const engine = createCommandEngine({ commands: [{ id: 'c', label: 'C', finalStep: { timing: 'before' }, steps: [{ id: 's', label: 'S', options: [{ value: 'x', label: 'X' }] }], run: () => {} }], tokens: { types: [user] } });
      engine.select(0);
      engine.setQuery('@kept'); engine.select(0);
      expect(engine.getSnapshot().phase).toBe('final');
      engine.back();
      expect(engine.getSnapshot().tokenFeedback.status).toBe('idle');
      engine.forward();
      expect(engine.getSnapshot().phase).toBe('final');
      expect(engine.getSnapshot().tokenFeedback.status).toBe('valid');
    });
  });

  describe('registry engines', () => {
    it('adds tokens and settleTokens to the command context when configured', async () => {
      const run = vi.fn();
      const options = vi.fn(async () => [{ value: 'x', label: 'X' }]);
      const registry = createCommandRegistry({ shared: { name: 'app' } });
      registry.register({ id: 'c', label: 'C', steps: [{ id: 's', label: 'S', options }], run });
      const engine = createCommandEngine({ registry, tokens: { types: [user] } });
      engine.setQuery('@alice');
      engine.select(0);
      await vi.waitFor(() => expect(engine.getSnapshot().items).toHaveLength(1));
      expect((options.mock.calls[0] as unknown[])[1]).toMatchObject({ shared: { name: 'app' }, tokens: [expect.objectContaining({ value: 'alice' })] });
      engine.select(0);
      await vi.waitFor(() => expect(run).toHaveBeenCalled());
      const context = run.mock.calls[0][1];
      expect(context.shared).toEqual({ name: 'app' });
      expect(context.tokens.map((token: Token) => token.value)).toEqual(['alice']);
      expect(typeof context.settleTokens).toBe('function');
    });
  });
});
