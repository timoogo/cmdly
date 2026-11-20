import { createElement } from 'react';
import type { BackBehavior, Command, Option } from '@cmdly/core';
import { ProjectResult } from './components/project-result';

export type Activity = { title: string; detail: string };

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const labelOf = (options: Option[], value: string) => options.find(option => option.value === value)?.label ?? value;
const workspaces: Option[] = [{ value: 'design', label: 'Design' }, { value: 'platform', label: 'Platform' }, { value: 'archive', label: 'Archive (no projects)' }];
const branches: Option[] = [{ value: 'main', label: 'main' }, { value: 'develop', label: 'develop' }];
const projects: Record<string, Option[]> = {
  design: [{ value: 'website', label: 'Website' }, { value: 'brand', label: 'Brand kit' }],
  platform: [{ value: 'api', label: 'Public API' }, { value: 'billing', label: 'Billing service' }],
  archive: [],
};

/**
 * One command per feature. `record` writes to the Activity panel; `shouldFail` is read at load time,
 * so the "Simulate loading failure" toggle applies to the next load without recreating the commands.
 */
export function createCommands(record: (activity: Activity) => void, shouldFail: () => boolean): Command[] {
  let syncAttempts = 0;
  // The same steps for each strategy. Going back pre-selects the answers the strategy remembers:
  // choose Production → United States, go back to Environment, then pick Staging (or Production again).
  const backBehavior = (mode: BackBehavior, hint: string): Command => ({
    id: mode, label: `${mode[0].toUpperCase()}${mode.slice(1)} — ${hint}`, backBehavior: mode, arrowNavigation: true,
    steps: [
      { id: 'environment', label: 'Environment', options: [{ value: 'staging', label: 'Staging' }, { value: 'production', label: 'Production' }] },
      { id: 'region', label: 'Region', options: async () => { await delay(400); return [{ value: 'eu', label: 'Europe' }, { value: 'us', label: 'United States' }]; } },
      { id: 'size', label: 'Size', options: [{ value: 'small', label: 'Small' }, { value: 'large', label: 'Large' }] },
    ],
    run: answers => record({ title: `Back behavior: ${mode}`, detail: JSON.stringify(answers) }),
  });

  return [
    { id: 'hello', label: 'Say hello', run: () => record({ title: 'Hello!', detail: 'A command without steps runs as soon as it is selected.' }) },
    {
      // Progress & async: three asynchronous steps (0 → 33 → 67 %), then a final step kept open at 100 %.
      id: 'open-project', label: 'Open a project', progress: 'local',
      steps: [
        { id: 'workspace', label: 'Workspace', options: async () => {
          await delay(700);
          if (shouldFail()) throw new Error('Workspace service unavailable');
          return workspaces;
        } },
        { id: 'project', label: 'Project', options: async answers => { await delay(700); return projects[answers.workspace] ?? []; } },
        { id: 'branch', label: 'Branch', options: async () => { await delay(700); return branches; } },
      ],
      // A custom final step: answers hold option values, so the summary looks their labels up.
      finalStep: { timing: 'after', closeOnComplete: false, render: context => createElement(ProjectResult, { context, rows: [
        { label: 'Workspace', value: labelOf(workspaces, context.answers.workspace) },
        { label: 'Project', value: labelOf(projects[context.answers.workspace] ?? [], context.answers.project) },
        { label: 'Branch', value: labelOf(branches, context.answers.branch) },
      ] }) },
      run: async answers => {
        await delay(1500);
        record({ title: 'Project opened', detail: `${labelOf(workspaces, answers.workspace)} / ${labelOf(projects[answers.workspace] ?? [], answers.project)} @ ${answers.branch}` });
      },
    },
    {
      // Steps & conditions: the access step only appears for admins.
      id: 'invite', label: 'Invite a teammate',
      steps: [
        { id: 'person', label: 'Teammate', options: [{ value: 'alice', label: 'Alice Martin' }, { value: 'bob', label: 'Bob Leroy' }, { value: 'chloe', label: 'Chloé Dubois' }] },
        { id: 'role', label: 'Role', options: [{ value: 'member', label: 'Member' }, { value: 'admin', label: 'Admin' }] },
        { id: 'access', label: 'Admin access', when: answers => answers.role === 'admin', options: [{ value: 'billing', label: 'Billing only' }, { value: 'full', label: 'Full access' }] },
      ],
      run: answers => record({ title: 'Invitation sent', detail: `${answers.person} as ${answers.role}${answers.access ? ` (${answers.access})` : ''}` }),
    },
    {
      // Confirmation: a final step before running, only for production; kept open to show the result.
      id: 'deploy', label: 'Deploy',
      steps: [{ id: 'environment', label: 'Environment', options: [{ value: 'staging', label: 'Staging' }, { value: 'production', label: 'Production' }] }],
      finalStep: { timing: 'before', when: answers => answers.environment === 'production', closeOnComplete: false },
      run: async answers => { await delay(400); record({ title: 'Deployed', detail: answers.environment }); },
    },
    {
      // Errors & retry: every other run fails; the final step shows the error and retries.
      id: 'sync', label: 'Sync data (fails, then retry)',
      finalStep: { timing: 'after', closeOnComplete: false, render: context => createElement('section', null,
        createElement('h2', null, 'Sync result'),
        createElement('p', { role: context.error ? 'alert' : 'status' }, context.error instanceof Error ? context.error.message : context.status),
        context.status === 'error' ? createElement('button', { type: 'button', onClick: () => void context.execute() }, 'Retry') : null,
        createElement('button', { type: 'button', onClick: context.close }, 'Close')) },
      run: async () => {
        await delay(600);
        if (++syncAttempts % 2 === 1) throw new Error('Temporary failure — try again');
        record({ title: 'Data synced', detail: 'The retry succeeded.' });
      },
    },
    {
      // Nested commands: a conditional child, ←/→ to move between visited levels, global progress.
      id: 'git', label: 'Git', arrowNavigation: true, progress: 'global',
      steps: [{ id: 'mode', label: 'Mode', options: [{ value: 'standard', label: 'Standard' }, { value: 'advanced', label: 'Advanced (unlocks Create branch)' }] }],
      commands: [{ id: 'branches', label: 'Branches', commands: [
        { id: 'list', label: 'List branches', run: answers => record({ title: 'Branches listed', detail: answers.mode }) },
        { id: 'create', label: 'Create branch', when: answers => answers.mode === 'advanced',
          steps: [{ id: 'base', label: 'Base', options: [{ value: 'main', label: 'main' }, { value: 'develop', label: 'develop' }] }],
          run: answers => record({ title: 'Branch created', detail: `from ${answers.base}` }) },
      ] }],
    },
    {
      id: 'back-behavior', label: 'Back behavior',
      commands: [
        backBehavior('preserve', 'remembers every answer'),
        backBehavior('reset', 'forgets answers when you go back'),
        backBehavior('smart', 'forgets later answers only if you change one'),
      ],
    },
    {
      id: 'large-list', label: 'Large list (10,000 options)', maxVisibleItems: 20,
      steps: [{ id: 'item', label: 'Item', options: Array.from({ length: 10_000 }, (_, i) => ({ value: `item-${i}`, label: `Item ${String(i).padStart(5, '0')}` })) }],
      run: answers => record({ title: 'Item chosen', detail: answers.item }),
    },
  ];
}
