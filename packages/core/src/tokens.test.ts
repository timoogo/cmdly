import { describe, expect, it } from 'vitest';
import { CmdlyError, defineTokenType, getTokenFeedback, tokenize, validateTokenType } from '@cmdly/core';
import type { Token, TokenScope, TokenType } from '@cmdly/core';

const user: TokenType = { id: 'user', prefix: '@' };
const team: TokenType = { id: 'team', prefix: '@@' };
const issue: TokenType = { id: 'issue', prefix: '#' };
const label: TokenType = { id: 'label', prefix: '#' };
const email: TokenType = { id: 'email', prefixMode: 'none', detect: /^[^@\s]+@[^@\s]+\.\w+$/ };
const ticket: TokenType = { id: 'ticket', prefixMode: 'none', detect: word => /^[A-Z]+-\d+$/.test(word) };
const global = (...types: TokenType[]): TokenScope => ({ kind: 'global', types });
const local = (...types: TokenType[]): TokenScope => ({ kind: 'step', types });
const ids = (query: string, scopes: TokenScope[], resolve?: Parameters<typeof tokenize>[2]) => tokenize(query, scopes, resolve).matches.map(match => match.type?.id ?? `?${match.candidates.map(type => type.id).join('|')}`);

describe('tokenize', () => {
  it('returns the query untouched when no type is active or nothing matches', () => {
    expect(tokenize('  deploy  prod ', [global()])).toEqual({ text: '  deploy  prod ', matches: [] });
    expect(tokenize('  deploy  prod ', [global(user)])).toEqual({ text: '  deploy  prod ', matches: [] });
  });

  it('extracts tokens with positions and normalizes the residual text', () => {
    const { text, matches } = tokenize('assign  @alice to #12 ', [global(user, issue)]);
    expect(text).toBe('assign to');
    expect(matches.map(({ type, prefix, value, raw, start, end, scope }) => ({ type: type?.id, prefix, value, raw, start, end, scope }))).toEqual([
      { type: 'user', prefix: '@', value: 'alice', raw: '@alice', start: 8, end: 14, scope: 'global' },
      { type: 'issue', prefix: '#', value: '12', raw: '#12', start: 18, end: 21, scope: 'global' },
    ]);
  });

  it('recognizes prefixes only at the start of a word', () => {
    expect(ids('mail me@home', [global(user)])).toEqual([]);
  });

  it('prefers the longest prefix, including multi-character prefixes', () => {
    expect(ids('@@core @alice', [global(user, team)])).toEqual(['team', 'user']);
    expect(tokenize('@@core', [global(user, team)]).matches[0].value).toBe('core');
  });

  it('applies the longest prefix before scope priority', () => {
    expect(ids('@@core', [local(user), global(team)])).toEqual(['team']);
  });

  it('lets a local type shadow a global type with the same prefix', () => {
    const localUser: TokenType = { id: 'member', prefix: '@' };
    expect(ids('@alice', [local(localUser), global(user)])).toEqual(['member']);
  });

  it('keeps an empty value as a token', () => {
    const { text, matches } = tokenize('find @', [global(user)]);
    expect(text).toBe('find');
    expect(matches[0]).toMatchObject({ prefix: '@', value: '' });
  });

  describe('prefix-less types', () => {
    it('detects whole words with a RegExp or a function', () => {
      const { text, matches } = tokenize('notify bob@example.com about ABC-42', [global(email, ticket)]);
      expect(text).toBe('notify about');
      expect(matches.map(match => [match.type?.id, match.prefix, match.value])).toEqual([['email', '', 'bob@example.com'], ['ticket', '', 'ABC-42']]);
    });

    it('resets stateful global RegExp rules between words', () => {
      const words: TokenType = { id: 'word', prefixMode: 'none', detect: /^x\d$/g };
      expect(ids('x1 x2 x3', [global(words)])).toEqual(['word', 'word', 'word']);
    });

    it('never mutates the RegExp instance and keeps native flag semantics', () => {
      const global = /^x\d$/g, sticky = /x\d/y, plain = /x\d/;
      global.lastIndex = 7; sticky.lastIndex = 3;
      expect(ids('x1 x2 x3', [{ kind: 'global', types: [{ id: 'g', prefixMode: 'none', detect: global }] }])).toEqual(['g', 'g', 'g']);
      expect(global.lastIndex).toBe(7);
      // `y`: the match must start at the first character of the word; without it, anywhere in the word.
      expect(tokenize('x1 ax1', [{ kind: 'global', types: [{ id: 'y', prefixMode: 'none', detect: sticky }] }]).matches.map(match => match.raw)).toEqual(['x1']);
      expect(sticky.lastIndex).toBe(3);
      expect(tokenize('x1 ax1', [{ kind: 'global', types: [{ id: 'p', prefixMode: 'none', detect: plain }] }]).matches.map(match => match.raw)).toEqual(['x1', 'ax1']);
      const insensitive = /^abc$/gi;
      expect(ids('ABC abc', [{ kind: 'global', types: [{ id: 'i', prefixMode: 'none', detect: insensitive }] }])).toEqual(['i', 'i']);
      expect(insensitive.lastIndex).toBe(0);
    });

    it('never tests a word that starts with an active prefix', () => {
      const any: TokenType = { id: 'any', prefixMode: 'none', detect: () => true };
      expect(ids('@alice bob', [global(user, any)])).toEqual(['user', 'any']);
    });

    it('lets the innermost scope win', () => {
      const localTicket: TokenType = { id: 'local-ticket', prefixMode: 'none', detect: /^[A-Z]+-\d+$/ };
      expect(ids('ABC-1', [local(localTicket), global(ticket)])).toEqual(['local-ticket']);
    });

    it('treats several matches in the same scope as a collision', () => {
      const anyUpper: TokenType = { id: 'upper', prefixMode: 'none', detect: /^[A-Z-\d]+$/ };
      expect(ids('ABC-1', [global(ticket, anyUpper)])).toEqual(['?ticket|upper']);
      expect(ids('ABC-1', [global(ticket, anyUpper)], ({ prefix }) => (prefix === '' ? 'upper' : undefined))).toEqual(['upper']);
    });
  });

  describe('collisions in the same scope', () => {
    it('never picks a type arbitrarily without a resolver', () => {
      const [match] = tokenize('#12', [global(issue, label)]).matches;
      expect(match.type).toBeUndefined();
      expect(match.candidates.map(type => type.id)).toEqual(['issue', 'label']);
    });

    it('uses the resolver with candidates in declaration order', () => {
      const calls: unknown[] = [];
      const resolve = (input: { prefix: string; value: string; candidates: TokenType[]; scope: string }) => { calls.push({ ...input, candidates: input.candidates.map(type => type.id) }); return /^\d+$/.test(input.value) ? 'issue' : 'label'; };
      expect(ids('#12 #bug', [global(issue, label)], resolve)).toEqual(['issue', 'label']);
      expect(calls[0]).toEqual({ prefix: '#', value: '12', candidates: ['issue', 'label'], scope: 'global' });
    });

    it('stays ambiguous when the resolver returns undefined or an unknown id', () => {
      expect(ids('#12', [global(issue, label)], () => undefined)).toEqual(['?issue|label']);
      expect(ids('#12', [global(issue, label)], () => 'user')).toEqual(['?issue|label']);
    });

    it('reports the scope kind to the resolver', () => {
      let scope = '';
      tokenize('#1', [{ kind: 'command', types: [issue, label] }], input => { scope = input.scope; return 'issue'; });
      expect(scope).toBe('command');
    });
  });
});

describe('validateTokenType', () => {
  const code = (type: unknown) => { try { validateTokenType(type as TokenType); return 'ok'; } catch (error) { return error instanceof CmdlyError ? `${error.code}:${(error.details as { reason: string }).reason}` : 'other'; } };
  it('accepts valid definitions', () => {
    expect(code(user)).toBe('ok');
    expect(code(email)).toBe('ok');
    expect(code({ id: 'x', prefixMode: 'required', prefix: '>>', values: [] })).toBe('ok');
  });
  it('rejects broken definitions with INVALID_TOKEN_TYPE', () => {
    expect(code({ id: '', prefix: '@' })).toMatch(/^INVALID_TOKEN_TYPE:id/);
    expect(code({ id: 'x', prefix: '' })).toMatch(/^INVALID_TOKEN_TYPE:prefix must be/);
    expect(code({ id: 'x', prefix: 'a b' })).toMatch(/whitespace/);
    expect(code({ id: 'x', prefixMode: 'none' })).toMatch(/requires a detect rule/);
    expect(code({ id: 'x', prefixMode: 'none', detect: /a/, prefix: '@' })).toMatch(/does not accept a prefix/);
    expect(code({ id: 'x', prefix: '@', values: [], match: () => true })).toMatch(/mutually exclusive/);
    expect(code({ id: 'x', prefixMode: 'word', prefix: '@' })).toMatch(/unknown prefixMode/);
  });
});

describe('getTokenFeedback', () => {
  const token = (status: Token['status'], value = 'v'): Token => ({ id: `${status}-${value}`, candidates: [], prefix: '@', value, raw: `@${value}`, start: 0, end: 1, status });
  it('is idle without reportable tokens', () => {
    expect(getTokenFeedback([])).toEqual({ status: 'idle', pending: [], issues: [] });
    expect(getTokenFeedback([token('invalid', '')]).status).toBe('idle');
  });
  it('aggregates by priority error > ambiguous > invalid > pending > valid', () => {
    expect(getTokenFeedback([token('valid')]).status).toBe('valid');
    expect(getTokenFeedback([token('valid'), token('pending')]).status).toBe('pending');
    expect(getTokenFeedback([token('pending'), token('invalid')]).status).toBe('invalid');
    expect(getTokenFeedback([token('invalid'), token('ambiguous')]).status).toBe('ambiguous');
    const feedback = getTokenFeedback([token('ambiguous'), token('error'), token('pending'), token('valid')]);
    expect(feedback.status).toBe('error');
    expect(feedback.pending.map(item => item.status)).toEqual(['pending']);
    expect(feedback.issues.map(item => item.status)).toEqual(['ambiguous', 'error']);
  });
});

describe('token type inference', () => {
  it('infers data from match and values', () => {
    const fromMatch = defineTokenType({ id: 'u', prefix: '@', match: async value => ({ valid: true as const, data: { login: value } }) });
    const fromValues = defineTokenType({ id: 'e', prefix: ':', values: [{ value: 'prod', data: { region: 'eu' } }] });
    const loginOf = (type: TokenType<{ login: string }>) => type.id;
    const regionOf = (type: TokenType<{ region: string }>) => type.id;
    expect(loginOf(fromMatch)).toBe('u');
    expect(regionOf(fromValues)).toBe('e');
    if (false) {
      // @ts-expect-error values and match are mutually exclusive
      defineTokenType({ id: 'x', prefix: '@', values: [], match: () => true });
      // @ts-expect-error prefix is required in 'required' mode
      defineTokenType({ id: 'x' });
      // @ts-expect-error detect is required in 'none' mode
      defineTokenType({ id: 'x', prefixMode: 'none' });
      // @ts-expect-error prefix is not allowed in 'none' mode
      defineTokenType({ id: 'x', prefixMode: 'none', detect: /a/, prefix: '@' });
      // @ts-expect-error matcher results must be boolean or discriminated by `valid`
      defineTokenType({ id: 'x', prefix: '@', match: () => 'yes' });
    }
  });
});
