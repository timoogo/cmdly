// @vitest-environment jsdom
import React, { useMemo, useState } from 'react';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  CommandBubble, CommandPalette, createCommandEngine, useCommandCombobox, useCommandSession,
  type Command, type CommandBubbleTriggerProps, type CommandCombobox, type CommandEngine, type EngineSnapshot,
} from '@cmdly/react';

afterEach(cleanup);

const steps: Command = { id: 'deploy', label: 'Deploy', steps: [{ id: 'env', label: 'Environment', options: [{ value: 'prod', label: 'Production' }] }], run: vi.fn() };
const commands = (run = vi.fn()): Command[] => [steps, { id: 'hello', label: 'Say hello', run }];
const userTokens = { types: [{ id: 'user', prefix: '@', values: [{ value: 'bob' }] }] };

/** A custom content built only from the headless props: no default markup. */
function Compact({ command }: { command: CommandCombobox }) {
  const { state, inputProps, listboxProps, getOptionProps, visibleItems, listVisible, dismiss, tokens } = command;
  return <div data-testid="custom">
    <input aria-label={state.step?.label ?? 'Find'} {...inputProps} />
    {tokens.bannerVisible && <p id={tokens.feedbackId}>{tokens.feedback.issues.length} invalid</p>}
    {listVisible && <ul {...listboxProps}>{visibleItems.map(({ item, index }) => <li key={index} {...getOptionProps(index)}>→ {item.label}</li>)}</ul>}
    <button type="button" onClick={dismiss}>Done</button>
  </div>;
}

describe('custom content (children)', () => {
  it('replaces the popover content and keeps keyboard, ARIA and closing behaviour', async () => {
    const user = userEvent.setup(), run = vi.fn();
    render(<><CommandBubble mode="standalone" commands={commands(run)}>{command => <Compact command={command} />}</CommandBubble><button>After</button></>);
    await user.click(screen.getByRole('button', { name: 'Command palette' }));
    const dialog = screen.getByRole('dialog', { name: 'Command palette' });
    expect(dialog.querySelector('[data-testid="custom"]')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull(); // default view not rendered
    const input = screen.getByRole('combobox', { name: 'Find' });
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute('aria-controls')).toBe(screen.getByRole('listbox').id);
    await user.keyboard('{ArrowDown}');
    expect(input.getAttribute('aria-activedescendant')).toBe(screen.getByRole('option', { name: '→ Say hello' }).id);
    await user.keyboard('{ArrowUp}{Enter}');
    expect(screen.getByRole('combobox', { name: 'Environment' })).toBeTruthy(); // step
    await user.keyboard('{Escape}');
    expect(screen.getByRole('combobox', { name: 'Find' })).toBeTruthy(); // back
    await user.keyboard('{ArrowDown}{Enter}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(run).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Command palette' }));
    await user.click(screen.getByRole('button', { name: 'Command palette' }));
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('replaces the palette content in trigger mode', async () => {
    const user = userEvent.setup();
    render(<CommandBubble commands={commands()}>{command => <Compact command={command} />}</CommandBubble>);
    await user.click(screen.getByRole('button', { name: 'Command palette' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.querySelector('[data-testid="custom"]')).not.toBeNull();
    await user.tab();
    await user.tab(); // Tab stays contained by the modal palette
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('keeps token announcements with a custom content', async () => {
    const user = userEvent.setup();
    render(<CommandPalette commands={[]} tokens={userTokens} open onOpenChange={() => {}}>{command => <Compact command={command} />}</CommandPalette>);
    const announcer = document.querySelector('[data-cmdly-token-announcer]')!;
    expect(screen.getByRole('dialog').contains(announcer)).toBe(true); // mounted by the container, before any token
    await user.type(screen.getByRole('combobox'), '@zed');
    expect(announcer.textContent).toBe('"@zed" is not valid');
    expect(screen.getByRole('combobox').getAttribute('aria-describedby')).toBe(screen.getByText('1 invalid').id);
  });

  it('dismisses an external engine without closing it', async () => {
    const user = userEvent.setup();
    const engine = createCommandEngine({ commands: commands() });
    render(<CommandBubble mode="standalone" engine={engine}>{command => <Compact command={command} />}</CommandBubble>);
    await user.click(screen.getByRole('button', { name: 'Command palette' }));
    await user.type(screen.getByRole('combobox'), 'hel');
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(engine.getSnapshot()).toMatchObject({ closed: false, query: 'hel' });
    await user.click(screen.getByRole('button', { name: 'Command palette' }));
    expect((screen.getByRole('combobox') as HTMLInputElement).value).toBe('hel');
    engine.destroy();
  });
});

describe('custom trigger element', () => {
  function Page({ mode }: { mode: 'trigger' | 'standalone' }) {
    return <CommandBubble mode={mode} commands={commands()} label="Actions"
      trigger={props => <button {...props} className="my-trigger"><svg aria-hidden="true" /> Actions</button>} />;
  }

  it.each(['standalone', 'trigger'] as const)('keeps ARIA, keyboard opening and focus restoration (%s)', async mode => {
    const user = userEvent.setup();
    render(<Page mode={mode} />);
    const trigger = screen.getByRole('button', { name: 'Actions' });
    expect(trigger.className).toBe('my-trigger');
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    await user.tab();
    await user.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog', { name: 'Actions' });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(trigger.getAttribute('aria-controls')).toBe(dialog.id);
    expect(trigger.dataset.state).toBe('open');
    expect(document.activeElement).toBe(screen.getByRole('combobox'));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it('still treats the custom trigger as part of the standalone bubble', async () => {
    const user = userEvent.setup();
    render(<Page mode="standalone" />);
    await user.click(screen.getByRole('button', { name: 'Actions' }));
    await user.click(screen.getByRole('button', { name: 'Actions' })); // re-activation closes, no outside-press conflict
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Actions' }));
    await user.tab({ shift: true });
    expect(screen.queryByRole('dialog')).not.toBeNull();
    await user.keyboard('{Escape}'); // Escape on the trigger
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('fully headless', () => {
  // Owned session: mounted while open, closed for good by `dismiss`. Commands are stable; callbacks may be inline.
  function Owned({ onClose, run }: { onClose: () => void; run: () => void }) {
    const owned = useMemo<Command[]>(() => [{ id: 'hello', label: 'Say hello', run }], [run]);
    const engine = useCommandSession({ commands: owned, tokens: userTokens, callbacks: { onClose } });
    const command = useCommandCombobox(engine);
    return <section aria-label="Commands" {...command.rootProps}>
      {command.tokens.announcer && <span {...command.tokens.announcer} />}
      <Compact command={command} />
    </section>;
  }
  function OwnedHost({ run = vi.fn() }: { run?: () => void }) {
    const [open, setOpen] = useState(true);
    return open ? <Owned onClose={() => setOpen(false)} run={run} /> : <p>closed</p>;
  }

  it('builds an owned session from the hooks only', async () => {
    const user = userEvent.setup(), run = vi.fn();
    render(<OwnedHost run={run} />);
    expect(document.activeElement).toBe(screen.getByRole('combobox'));
    expect(document.querySelector('[data-cmdly-token-announcer]')).not.toBeNull();
    await user.type(screen.getByRole('combobox'), '@zed');
    expect(document.querySelector('[data-cmdly-token-announcer]')!.textContent).toBe('"@zed" is not valid');
    await user.clear(screen.getByRole('combobox'));
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByText('closed')).toBeTruthy());
    expect(run).toHaveBeenCalledOnce();
    cleanup();
    render(<OwnedHost />);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.getByText('closed')).toBeTruthy());
  });

  it('displays an external engine and only hides it on dismiss', async () => {
    const user = userEvent.setup();
    const engine = createCommandEngine({ commands: commands() });
    function External() {
      const [open, setOpen] = useState(true);
      const command = useCommandCombobox(engine, { onDismiss: () => setOpen(false) });
      return open ? <section {...command.rootProps}><Compact command={command} /></section> : <button onClick={() => setOpen(true)}>Reopen</button>;
    }
    render(<External />);
    await user.type(screen.getByRole('combobox'), 'dep{Enter}');
    await user.keyboard('{Escape}{Escape}'); // step → menu, root → dismiss
    expect(engine.getSnapshot()).toMatchObject({ closed: false });
    await act(async () => { await Promise.resolve(); });
    expect(engine.getSnapshot().closed).toBe(false);
    engine.destroy();
  });

  it('types the public API', () => {
    expectTypeOf<CommandEngine>().toMatchTypeOf<Parameters<typeof useCommandCombobox>[0]>();
    expectTypeOf<CommandCombobox['state']>().toMatchTypeOf<Pick<EngineSnapshot, 'query' | 'phase' | 'active' | 'running' | 'tokenFeedback'>>();
    expectTypeOf<CommandCombobox['dismiss']>().toEqualTypeOf<() => void>();
    expectTypeOf<CommandBubbleTriggerProps['aria-expanded']>().toEqualTypeOf<boolean>();
    if (false as boolean) {
      void (<CommandBubble commands={[]} trigger={props => <a href="#" {...props} />}>{command => command.state.query}</CommandBubble>);
      // @ts-expect-error the content is a function of the headless state
      void (<CommandBubble commands={[]}><p>static</p></CommandBubble>);
      // @ts-expect-error unknown option
      useCommandCombobox(createCommandEngine({ commands: [] }), { root: null });
    }
  });
});
