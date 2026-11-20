// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommandBubble, CommandPalette, createCommandEngine, type Command, type FinalStep, type TokenRunContext } from '@cmdly/react';

afterEach(cleanup);

// Escape on a final screen closes directly, whatever its status; elsewhere it still goes back first.
const env = { id: 'env', label: 'Environment', options: [{ value: 'prod', label: 'Production' }] };
const command = (finalStep: FinalStep, run: Command['run'] = vi.fn()): Command => ({ id: 'deploy', label: 'Deploy', steps: [env], finalStep, run });
const before = () => command({ timing: 'before' });
const success = () => command({ timing: 'after', closeOnComplete: false });
const failure = () => command({ timing: 'after', closeOnComplete: false }, () => { throw new Error('Boom'); });
const dialog = () => screen.queryByRole('dialog');
const bubble = () => screen.getByRole('button', { name: 'Command palette' });

function Palette({ commands, onClose, onOpenChange }: { commands: Command[]; onClose?: () => void; onOpenChange?: (open: boolean) => void }) { // tokens: the run receives an AbortSignal
  const [open, setOpen] = useState(true);
  return <><button>Opener</button><CommandPalette commands={commands} tokens={{ types: [] }} callbacks={{ onClose }} open={open} onOpenChange={next => { onOpenChange?.(next); setOpen(next); }} /></>;
}
/** Selects Deploy, then Production: lands on the final screen. */
async function toFinal(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard('{Enter}');
  await user.keyboard('{Enter}');
}

describe('Escape on a final screen (owned session)', () => {
  it.each([
    ['a before confirmation that has not run', before, 'Confirm'],
    ['a successful result', success, 'Cancel'],
    ['a failed result', failure, 'Retry'],
  ])('closes %s directly', async (_name, make, visible) => {
    const user = userEvent.setup(), onClose = vi.fn(), onOpenChange = vi.fn(), deploy = make();
    render(<Palette commands={[deploy]} onClose={onClose} onOpenChange={onOpenChange} />);
    await toFinal(user);
    expect(await screen.findByRole('button', { name: visible })).toBeTruthy();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(dialog()).toBeNull());
    expect(onOpenChange.mock.calls).toEqual([[false]]);
    expect(onClose).toHaveBeenCalledOnce();
    if (make === before) expect(deploy.run).not.toHaveBeenCalled();
  });

  it('still goes back from a step, then closes at the root', async () => {
    const user = userEvent.setup();
    render(<Palette commands={[before()]} />);
    await user.keyboard('{Enter}');
    expect(screen.getByRole('combobox', { name: 'Environment' })).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('combobox', { name: 'Search commands' })).toBeTruthy();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(dialog()).toBeNull());
  });

  it('still aborts a running command', async () => {
    const user = userEvent.setup(), signals: (AbortSignal | undefined)[] = [];
    const run = vi.fn((_answers: unknown, context?: Partial<TokenRunContext>) => { signals.push(context?.signal); return new Promise<void>(() => {}); });
    render(<Palette commands={[{ id: 'slow', label: 'Slow', run }]} />);
    await user.keyboard('{Enter}');
    expect(screen.getByText('Running command…')).toBeTruthy();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(dialog()).toBeNull());
    expect(signals[0]?.aborted).toBe(true);
  });
});

describe('Escape on a final screen (external session)', () => {
  it('hides the interface and leaves the session on its final screen', async () => {
    const user = userEvent.setup(), onOpenChange = vi.fn();
    const engine = createCommandEngine({ commands: [success()] });
    function Page() {
      const [open, setOpen] = useState(true);
      return <CommandPalette engine={engine} open={open} onOpenChange={next => { onOpenChange(next); setOpen(next); }} />;
    }
    render(<Page />);
    await toFinal(user);
    await screen.findByRole('button', { name: 'Cancel' });
    await user.keyboard('{Escape}');
    expect(dialog()).toBeNull();
    expect(onOpenChange.mock.calls).toEqual([[false]]);
    expect(engine.getSnapshot()).toMatchObject({ closed: false, phase: 'final', status: 'success' });
    engine.destroy();
  });
});

describe('Escape on a final screen in every surface', () => {
  it.each(['trigger', 'standalone'] as const)('closes the %s bubble from a confirmation and returns focus to it', async mode => {
    const user = userEvent.setup(), deploy = before();
    render(<CommandBubble mode={mode} commands={[deploy]} />);
    await user.click(bubble());
    await toFinal(user);
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeTruthy();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(dialog()).toBeNull());
    expect(document.activeElement).toBe(bubble());
    expect(deploy.run).not.toHaveBeenCalled();
  });

  it('closes a custom final render (finalStep.render inside custom children)', async () => {
    const user = userEvent.setup();
    const custom = command({ timing: 'after', closeOnComplete: false, render: context => <button type="button" onClick={context.close}>Done</button> });
    render(<CommandBubble mode="standalone" commands={[custom]}>
      {({ state, inputProps, listboxProps, getOptionProps, visibleItems, finalContext }) => state.phase === 'final' && state.finalStep?.render
        ? <>{state.finalStep.render(finalContext) as React.ReactNode}</>
        : <><input {...inputProps} aria-label={state.step?.label ?? 'Search'} /><ul {...listboxProps}>{visibleItems.map(({ item, index }) => <li key={index} {...getOptionProps(index)}>{item.label}</li>)}</ul></>}
    </CommandBubble>);
    await user.click(bubble());
    await toFinal(user);
    await act(async () => {});
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Done' }));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(dialog()).toBeNull());
  });
});
