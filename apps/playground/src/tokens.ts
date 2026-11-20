import { defineTokenType, type Command, type Token, type TokenOptions } from '@cmdly/core';
import type { Activity } from './commands';

type Person = { login: string; name: string };
const people: Person[] = [{ login: 'alice', name: 'Alice Martin' }, { login: 'bob', name: 'Bob Leroy' }, { login: 'chloe', name: 'Chloé Dubois' }];

/** Simulated remote lookup: latency, cancellation through the AbortSignal, typed data. */
export function lookupPerson(login: string, signal: AbortSignal, latency = 600): Promise<Person | undefined> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(people.find(person => person.login === login.toLowerCase())), latency);
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  });
}

/** `@login`: async matcher returning typed data. */
export const userToken = defineTokenType({
  id: 'user', label: 'User', prefix: '@',
  match: async (value, { signal }) => {
    const person = await lookupPerson(value, signal);
    return person ? { valid: true as const, data: person } : { valid: false as const, message: `No user named "${value}"` };
  },
});

/** Prefix-less e-mail address, detected by a RegExp. */
export const emailToken = defineTokenType({ id: 'email', label: 'E-mail', prefixMode: 'none', detect: /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i });

/** `#` is shared by two types; the resolver picks one deterministically. */
export const issueToken = defineTokenType({ id: 'issue', label: 'Issue', prefix: '#', match: value => /^\d+$/.test(value) ? { valid: true as const, data: Number(value) } : false });
export const labelToken = defineTokenType({ id: 'label', label: 'Label', prefix: '#', values: [{ value: 'bug' }, { value: 'feature' }, { value: 'docs' }] });

export const tokenOptions: TokenOptions = {
  types: [userToken, emailToken, issueToken, labelToken],
  resolve: ({ prefix, value }) => (prefix === '#' ? (/^\d+$/.test(value) ? 'issue' : 'label') : undefined),
};

/** `!high`: local to the "priority" step only. */
export const priorityToken = defineTokenType({ id: 'priority', label: 'Priority', prefix: '!', values: [{ value: 'low' }, { value: 'high' }] });

const describe = (tokens: Token[]) => tokens.map(token => `${token.raw} → ${token.type ?? token.candidates.join('|')} (${token.status})`).join(', ') || 'no tokens';

/** A command that reads tokens and decides itself: it waits for validation, then refuses invalid users. */
export function createTokenCommands(record: (activity: Activity) => void): Command[] {
  return [{
    id: 'assign-issue', label: 'Assign issue (tokens: @user #42 #bug)',
    steps: [{ id: 'priority', label: 'Priority (try !high)', tokens: [priorityToken], options: [{ value: 'normal', label: 'Normal' }, { value: 'urgent', label: 'Urgent' }] }],
    run: async (answers, context) => {
      const tokens = (await context?.settleTokens?.()) ?? [];
      const rejected = tokens.filter(token => token.type === 'user' && token.status !== 'valid');
      if (rejected.length) throw new Error(`Cannot assign: ${rejected.map(token => token.message ?? token.raw).join(', ')}`);
      const users = tokens.filter(token => token.type === 'user').map(token => (token.data as Person).name);
      record({ title: 'Issue assigned', detail: `${answers.priority} · ${users.join(', ') || 'unassigned'} · ${describe(tokens)}` });
    },
  }];
}
