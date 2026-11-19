import { CmdlyError } from './errors.js';
import type { Token, TokenFeedback, TokenMatchResult, TokenResolver, TokenStatus, TokenType, TokenTypeRegistry, TokenValue } from './types.js';

/** Identity helper that infers `TData` from `values` or `match`. */
export function defineTokenType<TData = unknown>(type: TokenType<TData>): TokenType<TData> {
  return type;
}

type AnyType = TokenType<any>;
export type TokenScopeKind = 'global' | 'command' | 'step';
/** A group of token types sharing a priority level. Scopes are ordered innermost first. */
export type TokenScope = { kind: TokenScopeKind; types: readonly AnyType[] };

const invalid = (type: { id?: unknown }, reason: string) =>
  new CmdlyError('INVALID_TOKEN_TYPE', `Invalid token type "${String(type.id)}": ${reason}`, { typeId: String(type.id), reason });

const validated = new WeakSet<object>();
/** Throws `CmdlyError('INVALID_TOKEN_TYPE')` when a type breaks the contract. */
export function validateTokenType(type: AnyType): void {
  if (validated.has(type)) return;
  if (!type || typeof type.id !== 'string' || !type.id) throw invalid(type ?? {}, 'id must be a non-empty string');
  if (type.values !== undefined && type.match !== undefined) throw invalid(type, 'values and match are mutually exclusive');
  if (type.prefixMode === 'none') {
    if (!(type.detect instanceof RegExp) && typeof type.detect !== 'function') throw invalid(type, "prefixMode 'none' requires a detect rule");
    if (type.prefix !== undefined) throw invalid(type, "prefixMode 'none' does not accept a prefix");
  } else {
    if (type.prefixMode !== undefined && type.prefixMode !== 'required') throw invalid(type, `unknown prefixMode "${String(type.prefixMode)}"`);
    if (typeof type.prefix !== 'string' || !type.prefix) throw invalid(type, 'prefix must be a non-empty string');
    if (/\s/.test(type.prefix)) throw invalid(type, 'prefix must not contain whitespace');
  }
  validated.add(type);
}

/** Creates a registry of token types. `onChange` runs after every mutation. */
export function createTokenTypeRegistry(onChange: () => void, initial: readonly AnyType[] = []): TokenTypeRegistry & { reset: (types: readonly AnyType[]) => void } {
  let types = new Map<string, AnyType>();
  const fill = (list: readonly AnyType[]) => { const next = new Map<string, AnyType>(); for (const type of list) { validateTokenType(type); next.set(type.id, type); } types = next; };
  fill(initial);
  return {
    register(type) {
      validateTokenType(type);
      types.set(type.id, type); onChange();
      return () => { if (types.get(type.id) === type) { types.delete(type.id); onChange(); } };
    },
    unregister(id) { if (types.delete(id)) onChange(); },
    setValues(id, values) {
      const type = types.get(id);
      if (!type) throw invalid({ id }, 'unknown token type');
      if (type.match) throw invalid(type, 'setValues is not available for types using match');
      types.set(id, { ...type, values } as AnyType); onChange();
    },
    list: () => [...types.values()],
    reset(list) {
      const current = [...types.values()];
      if (current.length === list.length && list.every((type, i) => equivalentTokenTypes(type, current[i]))) return;
      fill(list); onChange();
    },
  };
}

/** A token located in the input, before validation. `type` is absent when the token is ambiguous. */
export type TokenMatch = { type?: AnyType; candidates: AnyType[]; scope: TokenScopeKind; prefix: string; value: string; raw: string; start: number; end: number };

// Private clones: the developer's RegExp (and its lastIndex) is never touched.
const clones = new WeakMap<RegExp, RegExp>();
/**
 * Tests a whole word with the type's rule. A RegExp keeps its pattern and flags, but is always run from the
 * start of the word: `g` has no effect (no state between words), `y` requires the match to start at the
 * first character of the word. The match does not have to cover the whole word unless the pattern uses `^…$`.
 */
const detects = (type: AnyType, word: string) => {
  const rule = type.detect!;
  if (typeof rule === 'function') return rule(word);
  let clone = clones.get(rule);
  if (!clone) { clone = new RegExp(rule.source, rule.flags); clones.set(rule, clone); }
  clone.lastIndex = 0;
  return clone.test(word);
};

const sameValues = (a: readonly TokenValue<unknown>[] | undefined, b: readonly TokenValue<unknown>[] | undefined) =>
  a === b || (!!a && !!b && a.length === b.length && a.every((item, i) => item.value === b[i].value && item.label === b[i].label && (item.data === b[i].data || JSON.stringify(item.data) === JSON.stringify(b[i].data))));

/** True when two definitions validate a value identically (same id, same `match` function, equal `values`). */
export function sameValidation(a: AnyType, b: AnyType): boolean {
  return a === b || (a.id === b.id && a.match === b.match && sameValues(a.values, b.values));
}

const sameDetection = (a: AnyType, b: AnyType) => (a.prefixMode ?? 'required') === (b.prefixMode ?? 'required') && a.prefix === b.prefix
  && (a.detect === b.detect || (a.detect instanceof RegExp && b.detect instanceof RegExp && a.detect.source === b.detect.source && a.detect.flags === b.detect.flags));

/** True when two definitions are interchangeable: same detection and same validation. */
export function equivalentTokenTypes(a: AnyType, b: AnyType): boolean {
  return a === b || (sameValidation(a, b) && sameDetection(a, b) && a.label === b.label);
}

/**
 * Locates tokens in `query`. Deterministic rules, per whitespace-separated word:
 * 1. the longest active prefix wins; 2. prefix-less types are tried only when no prefix matches;
 * 3. among equal prefixes, the innermost scope wins; 4. remaining collisions go to `resolve`, otherwise the token is ambiguous.
 * `text` is the query without tokens (whitespace normalized), or the query itself when nothing is recognized.
 */
export function tokenize(query: string, scopes: readonly TokenScope[], resolve?: TokenResolver): { text: string; matches: TokenMatch[] } {
  for (const scope of scopes) for (const type of scope.types) validateTokenType(type);
  if (!scopes.some(scope => scope.types.length)) return { text: query, matches: [] };
  const matches: TokenMatch[] = [], rest: string[] = [];
  for (const found of query.matchAll(/\S+/g)) {
    const word = found[0], start = found.index!;
    let best = 0;
    for (const scope of scopes) for (const type of scope.types) if (type.prefixMode !== 'none' && word.startsWith(type.prefix!) && type.prefix!.length > best) best = type.prefix!.length;
    const prefix = word.slice(0, best);
    let picked: { scope: TokenScope; candidates: AnyType[] } | undefined;
    for (const scope of scopes) {
      const candidates = best
        ? scope.types.filter(type => type.prefixMode !== 'none' && type.prefix === prefix)
        : scope.types.filter(type => type.prefixMode === 'none' && detects(type, word));
      if (candidates.length) { picked = { scope, candidates }; break; }
    }
    if (!picked) { rest.push(word); continue; }
    const value = word.slice(best);
    let type: AnyType | undefined = picked.candidates.length === 1 ? picked.candidates[0] : undefined;
    if (!type && resolve) { const id = resolve({ prefix, value, candidates: picked.candidates, scope: picked.scope.kind }); type = picked.candidates.find(candidate => candidate.id === id); }
    matches.push({ type, candidates: picked.candidates, scope: picked.scope.kind, prefix, value, raw: word, start, end: start + word.length });
  }
  return { text: matches.length ? rest.join(' ') : query, matches };
}

export type TokenOutcome = { status: TokenStatus; data?: unknown; message?: string; error?: unknown };

const normalize = (type: AnyType, value: string, result: TokenMatchResult<unknown>): TokenOutcome => {
  if (result === true) return { status: 'valid' };
  if (result === false) return { status: 'invalid' };
  if (result && typeof result === 'object' && result.valid === true) return { status: 'valid', data: result.data };
  if (result && typeof result === 'object' && result.valid === false) return { status: 'invalid', message: result.message };
  return { status: 'error', error: new CmdlyError('INVALID_TOKEN_MATCH', `Token matcher "${type.id}" returned an unsupported result`, { typeId: type.id, value, result }) };
};

/** Validates a value against its type. Returns synchronously unless `match` returns a promise. */
export function evaluateToken(type: AnyType, value: string, signal: AbortSignal): TokenOutcome | Promise<TokenOutcome> {
  if (!value) return { status: 'invalid' };
  if (type.match) {
    let result: TokenMatchResult<unknown> | Promise<TokenMatchResult<unknown>>;
    try { result = type.match(value, { signal, type }); } catch (error) { return { status: 'error', error }; }
    if (result && typeof (result as PromiseLike<unknown>).then === 'function') return Promise.resolve(result).then(resolved => normalize(type, value, resolved), error => ({ status: 'error' as const, error }));
    return normalize(type, value, result as TokenMatchResult<unknown>);
  }
  if (type.values) {
    const wanted = value.toLowerCase(), entry = (type.values as TokenValue<unknown>[]).find(item => item.value.toLowerCase() === wanted);
    return entry ? { status: 'valid', data: entry.data } : { status: 'invalid' };
  }
  return { status: 'valid' };
}

const rank: Record<TokenStatus, number> = { valid: 1, pending: 2, invalid: 3, ambiguous: 4, error: 5 };
/** Aggregates token statuses into a single, render-independent feedback. Empty-value tokens are ignored. */
export function getTokenFeedback(tokens: readonly Token[]): TokenFeedback {
  let status: TokenFeedback['status'] = 'idle';
  const pending: Token[] = [], issues: Token[] = [];
  for (const token of tokens) {
    if (!token.value) continue;
    if (token.status === 'pending') pending.push(token);
    else if (token.status !== 'valid') issues.push(token);
    if (status === 'idle' || rank[token.status] > rank[status]) status = token.status;
  }
  return { status, pending, issues };
}
