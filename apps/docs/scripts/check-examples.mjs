import { readFile } from 'node:fs/promises';
const checks = [
  ['simple.ts', 'getting-started/quick-start.mdx'],
  ['simple.ts', 'getting-started/first-command.mdx'],
  ['workflow.ts', 'getting-started/first-workflow.mdx'],
  ['registry.ts', 'registries/create-compose.mdx'],
  ['runtime.ts', 'registries/context-sessions.mdx'],
  ['react.tsx', 'react/integration.mdx'],
  ['next.tsx', 'react/nextjs.mdx'],
];
for (const [example, page] of checks) {
  const code = await readFile(new URL(`../examples/${example}`, import.meta.url), 'utf8');
  const mdx = await readFile(new URL(`../content/docs/${page}`, import.meta.url), 'utf8');
  const fence = example.endsWith('.tsx') ? 'tsx' : 'ts';
  if (!mdx.includes('```' + fence + '\n' + code + '```')) throw new Error(`${page} is out of sync with ${example}`);
}
console.log(`Verified ${checks.length} displayed examples`);
