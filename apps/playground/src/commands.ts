import { createElement } from 'react';
import type { BackBehavior, Command } from '@cmdly/core';

export type Activity = { title: string; detail: string };

// A short delay makes the library's loading state visible. The failure toggle
// lets the same command exercise its error and retry paths without a server.
export function createCommands(record: (activity: Activity) => void, shouldFail: boolean): Command[] {
  const backtracking = (mode: BackBehavior): Command => ({
    id: `backtracking-${mode}`, label: `Backtracking: ${mode}`, backBehavior: mode, arrowNavigation: true, progress: mode === 'preserve' ? 'local' : mode === 'smart' ? 'global' : false,
    steps: [
      { id: 'environment', label: 'Choose an environment', options: [{ value: 'staging', label: 'Staging' }, { value: 'production', label: 'Production' }] },
      { id: 'region', label: 'Choose a region', options: [{ value: 'eu', label: 'Europe' }, { value: 'us', label: 'US' }] },
    ],
    commands: ['Deploy', 'Preview'].map(label => ({
      id: label.toLowerCase(), label,
      steps: [{ id: 'target', label: 'Choose a target', options: [{ value: 'web', label: 'Web' }, { value: 'api', label: 'API' }] },
        { id: 'confirm', label: 'Confirm', options: [{ value: 'yes', label: 'Confirm' }] }],
      run: answers => record({ title: `${mode}: ${label}`, detail: JSON.stringify(answers) }),
    })),
  });
  let attempts = 0;
  return [
    {
      id: 'final-before', label: 'Review production deployment',
      steps: [
        { id: 'environment', label: 'Environment', options: [{ value: 'staging', label: 'Staging' }, { value: 'production', label: 'Production' }] },
        { id: 'region', label: 'Region', options: [{ value: 'eu', label: 'Europe' }, { value: 'us', label: 'United States' }] },
      ],
      finalStep: { timing: 'before', when: answers => answers.environment === 'production', fields: [{ id: 'region', label: 'Deployment region' }, { id: 'environment', label: 'Target' }] },
      run: async answers => { await new Promise(resolve => setTimeout(resolve, 400)); record({ title: 'Deployment reviewed', detail: JSON.stringify(answers) }); },
    },
    {
      id: 'final-inherited', label: 'Inherited confirmation',
      finalStep: { timing: 'before' },
      steps: [{ id: 'project', label: 'Project', options: [{ value: 'alpha', label: 'Alpha' }] }],
      commands: [{ id: 'create', label: 'Create', run: answers => record({ title: 'Created', detail: JSON.stringify(answers) }) }],
    },
    {
      id: 'final-after', label: 'Run with recoverable error',
      finalStep: { timing: 'after', closeOnComplete: false, render: context => createElement('section', null,
        createElement('h2', null, 'Execution result'),
        createElement('p', { role: context.error ? 'alert' : 'status' }, context.error instanceof Error ? context.error.message : context.status),
        context.status === 'error' ? createElement('button', { type: 'button', onClick: () => void context.execute() }, 'Retry') : null,
        createElement('button', { type: 'button', onClick: context.close }, 'Close')) },
      run: async () => { await new Promise(resolve => setTimeout(resolve, 400)); if (++attempts === 1) throw new Error('Temporary failure — try again'); record({ title: 'Recovered', detail: 'The retry succeeded.' }); },
    },
    ...(['preserve', 'reset', 'smart'] as const).map(backtracking),
    {
      id: 'git', label: 'Git', arrowNavigation: true, progress: 'global',
      steps: [{ id: 'mode', label: 'Choose a mode', options: [{ value: 'standard', label: 'Standard' }, { value: 'advanced', label: 'Advanced' }] }],
      commands: [{ id: 'branches', label: 'Branches', commands: [
        { id: 'list', label: 'List branches', run: answers => record({ title: 'Branches listed', detail: answers.mode }) },
        { id: 'create', label: 'Create branch', when: answers => answers.mode === 'advanced',
          steps: [{ id: 'base', label: 'Choose a base', options: [{ value: 'main', label: 'main' }, { value: 'develop', label: 'develop' }] }],
          run: answers => record({ title: 'Branch created', detail: `${answers.mode} · ${answers.base}` }) },
      ] }],
    },

{
  id: 'stress-large-list',
  label: 'Stress: 10,000 options',
  maxVisibleItems: 20,
  progress: 'global',
  arrowNavigation: true,
  steps: [{
    id: 'item',
    label: 'Choose from 10,000 items',
    options: Array.from({ length: 10_000 }, (_, i) => ({
      value: `item-${i}`,
      label: `Item ${String(i).padStart(5, '0')}`,
    })),
  }],
  run: (answers) => record({
    title: 'Large list completed',
    detail: answers.item,
  }),
},
{
  id: 'stress-slow',
  label: 'Stress: very slow request',
  steps: [{
    id: 'result',
    label: 'Wait for remote data',
    options: async () => {
      await new Promise(resolve => setTimeout(resolve, 10_000));
      return [
        { value: 'ready', label: 'Request completed' },
      ];
    },
  }],
  run: () => record({
    title: 'Slow request completed',
    detail: 'The command survived a 10-second delay.',
  }),
},
{
  id: 'stress-error',
  label: 'Stress: permanent API failure',
  steps: [{
    id: 'result',
    label: 'This request always fails',
    options: async () => {
      await new Promise(resolve => setTimeout(resolve, 500));
      throw new Error('HTTP 503: Service unavailable');
    },
  }],
  run: () => record({
    title: 'Unexpected execution',
    detail: 'This should never happen.',
  }),
},
{
  id: 'stress-conditional',
  label: 'Stress: conditional workflow',
  steps: [
    {
      id: 'mode',
      label: 'Choose a mode',
      options: [
        { value: 'simple', label: 'Simple' },
        { value: 'advanced', label: 'Advanced' },
      ],
    },
    {
      id: 'advanced',
      label: 'Advanced settings',
      when: (answers) => answers.mode === 'advanced',
      options: [
        { value: 'fast', label: 'Fast' },
        { value: 'safe', label: 'Safe' },
      ],
    },
    {
      id: 'confirmation',
      label: 'Confirm execution',
      options: [
        { value: 'yes', label: 'Confirm' },
        { value: 'no', label: 'Cancel' },
      ],
    },
  ],
  run: (answers) => record({
    title: 'Conditional workflow completed',
    detail: JSON.stringify(answers),
  }),
},
{
  id: 'stress-empty',
  label: 'Stress: empty API response',
  steps: [{
    id: 'result',
    label: 'No results available',
    options: async () => {
      await new Promise(resolve => setTimeout(resolve, 500));
      return [];
    },
  }],
  run: () => record({
    title: 'Unexpected execution',
    detail: 'An empty selection should not submit.',
  }),
},
{
  id: 'stress-duplicates',
  label: 'Stress: duplicate option labels',
  steps: [{
    id: 'choice',
    label: 'Choose an identical-looking option',
    options: [
      { value: 'first', label: 'Duplicate' },
      { value: 'second', label: 'Duplicate' },
      { value: 'third', label: 'Duplicate' },
    ],
  }],
  run: (answers) => record({
    title: 'Duplicate test completed',
    detail: `Selected value: ${answers.choice}`,
  }),
},

{
  id: 'test-preserve',
  label: 'Test: preserve across branches',
  backBehavior: 'preserve',
  steps: [{
    id: 'environment',
    label: 'Environment',
    options: [
      { value: 'dev', label: 'Development' },
      { value: 'prod', label: 'Production' },
    ],
  }],
  commands: [
    {
      id: 'deploy',
      label: 'Deploy',
      steps: [{
        id: 'target',
        label: 'Deploy target',
        options: [
          { value: 'web', label: 'Web' },
          { value: 'api', label: 'API' },
        ],
      }],
      run: answers => record({
        title: 'Preserve: Deploy',
        detail: JSON.stringify(answers),
      }),
    },
    {
      id: 'preview',
      label: 'Preview',
      steps: [{
        id: 'target',
        label: 'Preview target',
        options: [
          { value: 'mobile', label: 'Mobile' },
          { value: 'desktop', label: 'Desktop' },
        ],
      }],
      run: answers => record({
        title: 'Preserve: Preview',
        detail: JSON.stringify(answers),
      }),
    },
  ],
},
{
  id: 'test-reset',
  label: 'Test: reset on back',
  backBehavior: 'reset',
  steps: [
    {
      id: 'project',
      label: 'Choose project',
      options: [
        { value: 'alpha', label: 'Alpha' },
        { value: 'beta', label: 'Beta' },
      ],
    },
    {
      id: 'region',
      label: 'Choose region',
      options: [
        { value: 'eu', label: 'Europe' },
        { value: 'us', label: 'United States' },
      ],
    },
    {
      id: 'target',
      label: 'Choose target',
      options: [
        { value: 'web', label: 'Web' },
        { value: 'api', label: 'API' },
      ],
    },
  ],
  run: answers => record({
    title: 'Reset completed',
    detail: JSON.stringify(answers),
  }),
},
{
  id: 'test-smart',
  label: 'Test: smart invalidation',
  backBehavior: 'smart',
  steps: [
    {
      id: 'environment',
      label: 'Choose environment',
      options: [
        { value: 'dev', label: 'Development' },
        { value: 'prod', label: 'Production' },
      ],
    },
    {
      id: 'credentials',
      label: 'Production credentials',
      when: answers => answers.environment === 'prod',
      options: [
        { value: 'admin', label: 'Admin' },
        { value: 'service', label: 'Service account' },
      ],
    },
    {
      id: 'region',
      label: 'Choose region',
      options: [
        { value: 'eu', label: 'Europe' },
        { value: 'us', label: 'US' },
      ],
    },
  ],
  run: answers => record({
    title: 'Smart completed',
    detail: JSON.stringify(answers),
  }),
},
{
  id: 'test-inheritance',
  label: 'Test: inherited backBehavior',
  backBehavior: 'preserve',
  steps: [{
    id: 'workspace',
    label: 'Choose workspace',
    options: [
      { value: 'personal', label: 'Personal' },
      { value: 'team', label: 'Team' },
    ],
  }],
  commands: [
    {
      id: 'inherited',
      label: 'Inherited preserve',
      steps: [{
        id: 'action',
        label: 'Choose action',
        options: [
          { value: 'read', label: 'Read' },
          { value: 'write', label: 'Write' },
        ],
      }],
      run: answers => record({
        title: 'Inherited preserve',
        detail: JSON.stringify(answers),
      }),
    },
    {
      id: 'override',
      label: 'Override: reset',
      backBehavior: 'reset',
      steps: [{
        id: 'action',
        label: 'Choose action',
        options: [
          { value: 'delete', label: 'Delete' },
          { value: 'archive', label: 'Archive' },
        ],
      }],
      run: answers => record({
        title: 'Override reset',
        detail: JSON.stringify(answers),
      }),
    },
  ],
},
{
  id: 'test-recursive',
  label: 'Test: deep recursive workflow',
  backBehavior: 'smart',
  steps: [{
    id: 'organization',
    label: 'Choose organization',
    options: [
      { value: 'acme', label: 'Acme' },
      { value: 'globex', label: 'Globex' },
    ],
  }],
  commands: [{
    id: 'projects',
    label: 'Projects',
    commands: [{
      id: 'services',
      label: 'Services',
      commands: [{
        id: 'deployment',
        label: 'Deployment',
        steps: [{
          id: 'version',
          label: 'Choose version',
          options: [
            { value: 'stable', label: 'Stable' },
            { value: 'canary', label: 'Canary' },
          ],
        }],
        run: answers => record({
          title: 'Recursive deployment',
          detail: JSON.stringify(answers),
        }),
      }],
    }],
  }],
},
{
  id: 'test-async-invalidation',
  label: 'Test: smart async validation',
  backBehavior: 'smart',
  steps: [
    {
      id: 'dataset',
      label: 'Choose dataset',
      options: [
        { value: 'a', label: 'Dataset A' },
        { value: 'b', label: 'Dataset B' },
      ],
    },
    {
      id: 'item',
      label: 'Choose dynamic item',
      options: async answers => {
        await new Promise(resolve => setTimeout(resolve, 400));
        return answers.dataset === 'a'
          ? [
              { value: 'shared', label: 'Shared item' },
              { value: 'a-only', label: 'Only A' },
            ]
          : [
              { value: 'shared', label: 'Shared item' },
              { value: 'b-only', label: 'Only B' },
            ];
      },
    },
    {
      id: 'confirm',
      label: 'Confirm selection',
      options: [
        { value: 'yes', label: 'Confirm' },
      ],
    },
  ],
  run: answers => record({
    title: 'Async validation completed',
    detail: JSON.stringify(answers),
  }),
},

...(['before', 'after'] as const).map(timing => ({
  id: `test-async-invalidation-${timing}`,
  label: `Test: smart async validation (${timing})`,
  backBehavior: 'smart' as const,
  steps: [
    { id: 'dataset', label: 'Choose dataset', options: [
      { value: 'a', label: 'Dataset A' }, { value: 'b', label: 'Dataset B' },
    ] },
    { id: 'item', label: 'Choose dynamic item', options: async (answers: Record<string, string>) => {
      await new Promise(resolve => setTimeout(resolve, 400));
      return [
        { value: 'shared', label: 'Shared item' },
        answers.dataset === 'a' ? { value: 'a-only', label: 'Only A' } : { value: 'b-only', label: 'Only B' },
      ];
    } },
    { id: 'confirm', label: 'Confirm selection', options: [{ value: 'yes', label: 'Confirm' }] },
  ],
  finalStep: { timing, closeOnComplete: false },
  run: (answers: Record<string, string>) => {
    record({ title: `Async validation ${timing}`, detail: JSON.stringify(answers) });
    return `Validated ${answers.item} from dataset ${answers.dataset}`;
  },
})),

  ];
}
