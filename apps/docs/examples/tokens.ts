import { createCommandEngine, defineTokenType, type Command } from '@cmdly/core';

const user = defineTokenType({
  id: 'user',
  prefix: '@',
  match: async (login, { signal }) => {
    const response = await fetch(`/api/users/${encodeURIComponent(login)}`, { signal });
    if (!response.ok) return { valid: false, message: `Unknown user ${login}` };
    return { valid: true, data: (await response.json()) as { id: string; name: string } };
  },
});

const assign: Command = {
  id: 'assign',
  label: 'Assign',
  run: async (_answers, context) => {
    const tokens = (await context?.settleTokens?.()) ?? [];
    if (tokens.some(token => token.type === 'user' && token.status !== 'valid')) throw new Error('Fix the users first');
  },
};

const engine = createCommandEngine({ commands: [assign], tokens: { types: [user] } });
engine.setQuery('assign @alice');
// engine.getSnapshot().text   → 'assign' (drives search)
// engine.getSnapshot().tokens → [{ type: 'user', value: 'alice', status: 'pending', … }]
