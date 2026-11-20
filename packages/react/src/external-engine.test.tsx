// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommandPalette, createCommandEngine, createCommandRegistry, type CommandEngine, type CommandPaletteProps, type TokenRunContext } from '@cmdly/react';

afterEach(cleanup);

// A destroyed engine no longer notifies its subscribers.
const alive = (engine: CommandEngine) => {
  let notified = 0;
  const off = engine.subscribe(() => { notified++; });
  const query = engine.getSnapshot().query;
  engine.setQuery(`${query}?`); engine.setQuery(query);
  off();
  return notified > 0;
};

function Host({ engine, label }: { engine: CommandPaletteProps['engine']; label?: string }) {
  const [open, setOpen] = useState(false);
  return <>
    <button onClick={() => setOpen(true)}>Open</button>
    <span data-testid="open">{String(open)}</span>
    <CommandPalette engine={engine!} open={open} onOpenChange={setOpen} label={label} />
  </>;
}

const stepped = (run = vi.fn()) => createCommandEngine({
  commands: [
    { id: 'deploy', label: 'Deploy', steps: [{ id: 'env', label: 'Environment', options: [{ value: 'prod', label: 'Production' }, { value: 'dev', label: 'Development' }] }], run },
    { id: 'other', label: 'Other', run: vi.fn() },
  ],
  tokens: { types: [{ id: 'user', prefix: '@' }] },
});

describe('CommandPalette with an external engine', () => {
  it('dismisses the interface without closing or destroying the session, and resumes it', async () => {
    const user = userEvent.setup(), onClose = vi.fn();
    const engine = stepped();
    engine.setOptions({ callbacks: { onClose } });
    render(<Host engine={engine} />);
    const opener = screen.getByRole('button', { name: 'Open' });
    await user.click(opener);
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeTruthy();
    await user.keyboard('{Enter}'); // Deploy → Environment step
    await user.type(screen.getByRole('combobox', { name: 'Environment' }), 'prod @alice');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('open').textContent).toBe('false');
    expect(document.activeElement).toBe(opener);
    await act(async () => { await Promise.resolve(); });
    expect(engine.getSnapshot().closed).toBe(false);
    expect(alive(engine)).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    expect(engine.getSnapshot()).toMatchObject({ query: 'prod @alice', step: { label: 'Environment' } });

    await user.click(opener);
    expect(screen.getByRole('combobox', { name: 'Environment' })).toBeTruthy();
    await user.keyboard('{Escape}{Escape}'); // step → menu, menu root → dismiss (not close)
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(engine.getSnapshot().closed).toBe(false);
    engine.destroy();
  });

  it('can be shown successively by several interfaces with their own labels', async () => {
    const user = userEvent.setup();
    const engine = stepped();
    const first = render(<CommandPalette engine={engine} open onOpenChange={() => {}} label="First" />);
    await user.keyboard('{Enter}');
    await user.type(screen.getByRole('combobox'), 'pro');
    first.unmount();
    render(<CommandPalette engine={engine} open onOpenChange={() => {}} label="Second" />);
    expect(screen.getByRole('dialog', { name: 'Second' })).toBeTruthy();
    expect((screen.getByRole('combobox', { name: 'Environment' }) as HTMLInputElement).value).toBe('pro');
    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['Production']);
    expect(document.activeElement).toBe(screen.getByRole('combobox'));
    engine.destroy();
  });

  it('keeps a running command alive when the interface is dismissed', async () => {
    const user = userEvent.setup();
    let finish!: () => void, signal: AbortSignal | undefined;
    const run = vi.fn((_answers: unknown, context?: Partial<TokenRunContext>) => { signal = context?.signal; return new Promise<void>(done => { finish = done; }); });
    const engine = createCommandEngine({ commands: [{ id: 'slow', label: 'Slow', finalStep: { timing: 'after', closeOnComplete: false }, run }], tokens: { types: [] } });
    render(<Host engine={engine} />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.keyboard('{Enter}');
    expect(engine.getSnapshot().running).toBe(true);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(signal?.aborted).toBe(false);
    await act(async () => { finish(); });
    expect(engine.getSnapshot().status).toBe('success');
    engine.destroy();
  });

  it('follows the engine when it closes itself, and refuses to show a closed engine', async () => {
    const user = userEvent.setup(), run = vi.fn();
    const engine = createCommandEngine({ commands: [{ id: 'a', label: 'Alpha', run }] });
    render(<Host engine={engine} />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByTestId('open').textContent).toBe('false'));
    expect(run).toHaveBeenCalledOnce();
    expect(engine.getSnapshot().closed).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await waitFor(() => expect(screen.getByTestId('open').textContent).toBe('false'));
    expect(screen.queryByRole('dialog')).toBeNull();
    engine.destroy();
  });

  it('dismisses through the final step context', async () => {
    const user = userEvent.setup();
    const engine = createCommandEngine({ commands: [{ id: 'c', label: 'Confirm me', finalStep: { timing: 'before', render: context => <button onClick={context.close}>Leave</button> }, run: vi.fn() }] });
    render(<Host engine={engine} />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.keyboard('{Enter}');
    await user.click(screen.getByRole('button', { name: 'Leave' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(engine.getSnapshot()).toMatchObject({ closed: false, phase: 'final' });
    engine.destroy();
  });

  it('displays a dynamic registry engine with its runtime context', async () => {
    const user = userEvent.setup();
    const registry = createCommandRegistry<{ team: string }, { userId: string }>({ shared: { team: 'core' }, runtimeRequired: true });
    const run = vi.fn();
    registry.register({ id: 'whoami', label: 'Who am I', run: (_answers, context) => run(context.shared.team, context.runtime.userId) });
    const engine = createCommandEngine({ registry, runtime: () => ({ userId: 'alice' }) });
    render(<Host engine={engine} />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await waitFor(() => expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['Who am I']));
    act(() => { registry.register({ id: 'later', label: 'Registered later', run: vi.fn() }); engine.refreshRegistry(); });
    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['Who am I', 'Registered later']);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(run).toHaveBeenCalledWith('core', 'alice'));
    engine.destroy();
  });

  it('shows the token feedback of the external engine', async () => {
    const user = userEvent.setup();
    const engine = createCommandEngine({ commands: [], tokens: { types: [{ id: 'user', prefix: '@', values: [{ value: 'bob' }] }] } });
    render(<CommandPalette engine={engine} open onOpenChange={() => {}} />);
    expect(document.querySelector('[data-cmdly-token-announcer]')).not.toBeNull(); // mounted before the first token
    await user.type(screen.getByRole('combobox'), '@zed');
    expect(document.querySelector('[data-cmdly-token-feedback="banner"]')?.textContent).toContain('"@zed" is not valid');
    engine.destroy();
  });
});

describe('CommandPalette with its own engine', () => {
  it('keeps the default label and still closes the session it owns', async () => {
    const user = userEvent.setup(), onClose = vi.fn(), onOpenChange = vi.fn();
    render(<CommandPalette commands={[{ id: 'a', label: 'Alpha', run: vi.fn() }]} callbacks={{ onClose }} open onOpenChange={onOpenChange} />);
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeTruthy();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('accepts a custom label', () => {
    render(<CommandPalette commands={[]} open onOpenChange={() => {}} label="Actions" />);
    expect(screen.getByRole('dialog', { name: 'Actions' })).toBeTruthy();
  });
});

it('rejects ambiguous configurations at compile time', () => {
  const engine = createCommandEngine({ commands: [] });
  const registry = createCommandRegistry<{ team: string }, { id: string }>({ shared: { team: 'x' }, runtimeRequired: true });
  const registryEngine = createCommandEngine({ registry, runtime: () => ({ id: 'x' }) });
  const ok: CommandPaletteProps[] = [
    { commands: [], open: true, onOpenChange: () => {} },
    { engine, open: true, onOpenChange: () => {} },
    { engine: registryEngine, open: true, onOpenChange: () => {}, label: 'Registry', tokenFeedback: 'loader' },
  ];
  expect(ok).toHaveLength(3);
  if (false as boolean) {
    // @ts-expect-error engine and commands are mutually exclusive
    void (<CommandPalette engine={engine} commands={[]} open onOpenChange={() => {}} />);
    // @ts-expect-error session options belong to the external engine
    void (<CommandPalette engine={engine} tokens={{ types: [] }} open onOpenChange={() => {}} />);
    // @ts-expect-error session options belong to the external engine
    void (<CommandPalette engine={engine} plugins={[]} open onOpenChange={() => {}} />);
    // @ts-expect-error either commands or engine is required
    void (<CommandPalette open onOpenChange={() => {}} />);
  }
});
