// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommandPalette, type Command, type TokenFeedbackMode, type TokenFeedbackProps, type TokenOptions } from '@cmdly/react';

afterEach(cleanup);
const deferred = () => { let resolve!: (value: boolean) => void; const promise = new Promise<boolean>(res => { resolve = res; }); return { promise, resolve }; };
const commands: Command[] = [{ id: 'assign', label: 'Assign', run: vi.fn() }, { id: 'deploy', label: 'Deploy', run: vi.fn() }];
const announcer = () => document.querySelector('[data-cmdly-token-announcer]');
const banner = () => document.querySelector('[data-cmdly-token-feedback="banner"]');

function Palette({ tokens, tokenFeedback, items = commands }: { tokens?: TokenOptions; tokenFeedback?: TokenFeedbackMode; items?: Command[] }) {
  return <CommandPalette commands={items} open onOpenChange={() => {}} tokens={tokens} tokenFeedback={tokenFeedback} />;
}

describe('token feedback', () => {
  it('renders nothing when no token type is configured', async () => {
    render(<Palette />);
    await userEvent.setup().type(screen.getByRole('combobox'), '@alice');
    expect(document.querySelector('[data-cmdly-token-feedback], [data-cmdly-token-announcer]')).toBeNull();
    expect(screen.getByRole('combobox').getAttribute('aria-describedby')).toBeNull();
  });

  it('shows a banner of issues linked to the input and announces each issue once', async () => {
    const user = userEvent.setup();
    render(<Palette tokens={{ types: [{ id: 'user', prefix: '@', values: [{ value: 'bob' }] }, { id: 'a', prefix: '#' }, { id: 'b', prefix: '#' }] }} />);
    const input = screen.getByRole('combobox');
    expect(announcer()?.textContent).toBe('');
    await user.type(input, '@');
    expect(banner()).toBeNull(); // empty tokens are not reported
    await user.type(input, 'alice');
    expect(banner()?.getAttribute('data-status')).toBe('invalid');
    expect(banner()?.textContent).toContain('"@alice" is not valid');
    expect(input.getAttribute('aria-describedby')).toBe(banner()?.id);
    expect(announcer()?.textContent).toBe('"@alice" is not valid');
    await user.type(input, ' #1');
    expect(banner()?.getAttribute('data-status')).toBe('ambiguous');
    expect(announcer()?.textContent).toBe('"#1" is ambiguous (a, b)');
    await user.type(input, 'x'); // "#1x" is a new token: announced; "@alice" is not repeated
    expect(announcer()?.textContent).toBe('"#1x" is ambiguous (a, b)');
    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['Assign', 'Deploy']);
  });

  it('shows the validation in progress in the banner', async () => {
    const gate = deferred();
    render(<Palette tokens={{ types: [{ id: 'user', prefix: '@', match: () => gate.promise }] }} />);
    await userEvent.setup().type(screen.getByRole('combobox'), '@a');
    expect(banner()?.textContent).toContain('Validating…');
    await act(async () => { gate.resolve(true); });
    await waitFor(() => expect(banner()).toBeNull());
  });

  it('shows a global loader and marks the list busy while tokens are pending', async () => {
    const gate = deferred();
    render(<Palette tokenFeedback="loader" tokens={{ types: [{ id: 'user', prefix: '@', match: () => gate.promise }] }} />);
    await userEvent.setup().type(screen.getByRole('combobox'), '@a');
    expect(document.querySelector('[data-cmdly-token-feedback="loader"]')).not.toBeNull();
    expect(screen.getByRole('listbox').getAttribute('aria-busy')).toBe('true');
    expect(announcer()?.textContent).toBe('Validating…');
    expect(banner()).toBeNull();
    await act(async () => { gate.resolve(false); });
    await waitFor(() => expect(document.querySelector('[data-cmdly-token-feedback="loader"]')).toBeNull());
    expect(screen.getByRole('listbox').getAttribute('aria-busy')).toBeNull();
  });

  it('renders nothing in none mode', async () => {
    render(<Palette tokenFeedback="none" tokens={{ types: [{ id: 'user', prefix: '@', match: () => false }] }} />);
    await userEvent.setup().type(screen.getByRole('combobox'), '@a');
    expect(document.querySelector('[data-cmdly-token-feedback], [data-cmdly-token-announcer]')).toBeNull();
  });

  it('renders a custom component with the global feedback and tokens', async () => {
    const Custom = vi.fn(({ feedback, tokens }: TokenFeedbackProps) => <output>{feedback.status}:{tokens.map(token => token.value).join(',')}</output>);
    render(<Palette tokenFeedback={Custom} tokens={{ types: [{ id: 'user', prefix: '@' }] }} />);
    expect(screen.getByRole('status').textContent).toBe('idle:'); // mounted before the first token
    await userEvent.setup().type(screen.getByRole('combobox'), '@a @b');
    expect(screen.getByRole('status').textContent).toBe('valid:a,b');
    expect(document.querySelector('[data-cmdly-token-announcer]')).toBeNull();
  });

  it('applies token prop changes to the open palette', async () => {
    function Switcher() {
      const [tokens, setTokens] = useState<TokenOptions>({ types: [{ id: 'user', prefix: '@', match: () => false }] });
      return <><button onClick={() => setTokens({ types: [{ id: 'user', prefix: '@', match: () => true }] })}>Swap</button><Palette tokens={tokens} /></>;
    }
    const user = userEvent.setup();
    render(<Switcher />);
    await user.type(screen.getByRole('combobox'), '@a');
    expect(banner()?.getAttribute('data-status')).toBe('invalid');
    await user.click(screen.getByRole('button', { name: 'Swap' }));
    expect(banner()).toBeNull();
  });

  it('keeps keyboard navigation unchanged with tokens in the input', async () => {
    const user = userEvent.setup(), run = vi.fn();
    render(<Palette tokens={{ types: [{ id: 'user', prefix: '@' }] }} items={[{ id: 'a', label: 'Alpha', run: vi.fn() }, { id: 'b', label: 'Beta', run }]} />);
    const input = screen.getByRole('combobox');
    await user.type(input, '@me ');
    expect(screen.getAllByRole('option')).toHaveLength(2);
    await user.keyboard('{ArrowDown}{Enter}');
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(run.mock.calls[0][1].tokens.map((token: { value: string }) => token.value)).toEqual(['me']);
  });

  describe('audit fixes', () => {
    it('announces every loader episode and clears the announcement when validation ends', async () => {
      const gates: ReturnType<typeof deferred>[] = [];
      render(<Palette tokenFeedback="loader" tokens={{ types: [{ id: 'user', prefix: '@', match: () => { const gate = deferred(); gates.push(gate); return gate.promise; } }] }} />);
      const user = userEvent.setup(), input = screen.getByRole('combobox');
      await user.type(input, '@a');
      expect(announcer()?.textContent).toBe('Validating…');
      await act(async () => { gates[gates.length - 1].resolve(true); });
      await waitFor(() => expect(announcer()?.textContent).toBe(''));
      await user.type(input, 'b');
      expect(announcer()?.textContent).toBe('Validating…');
    });

    it('clears stale banner announcements and re-announces identical messages', async () => {
      const user = userEvent.setup();
      render(<Palette tokens={{ types: [{ id: 'user', prefix: '@', values: [{ value: 'ok' }] }] }} />);
      const input = screen.getByRole('combobox');
      await user.type(input, '@x');
      expect(announcer()?.textContent).toBe('"@x" is not valid');
      await user.clear(input);
      expect(announcer()?.textContent).toBe('');
      await user.type(input, '@x'); // a new token with the same text is announced again after clearing
      expect(announcer()?.textContent).toBe('"@x" is not valid');
      await user.type(input, ' @x'); // identical text while the previous message stands: made distinct
      expect(announcer()?.textContent).toBe('"@x" is not valid\u00a0');
      await user.type(input, '{Backspace}{Backspace}{Backspace}'); // the announced token is gone: stale message cleared
      expect(announcer()?.textContent).toBe('');
      expect(banner()?.textContent).toContain('"@x" is not valid'); // the banner still describes the remaining issue
    });

    it('keeps the feedback visible during the final confirmation step', async () => {
      const gate = deferred();
      render(<Palette tokens={{ types: [{ id: 'user', prefix: '@', match: () => gate.promise }] }} items={[{ id: 'c', label: 'Confirm me', finalStep: { timing: 'before' }, run: vi.fn() }]} />);
      const user = userEvent.setup();
      await user.type(screen.getByRole('combobox'), '@slow{Enter}');
      expect(screen.getByRole('button', { name: 'Confirm' })).toBeTruthy();
      expect(banner()?.textContent).toContain('Validating…');
      await act(async () => { gate.resolve(false); });
      await waitFor(() => expect(banner()?.textContent).toContain('"@slow" is not valid'));
    });

    it('mounts the live region as soon as local token types become active', async () => {
      render(<Palette items={[{ id: 'c', label: 'Step', steps: [{ id: 's', label: 'Pick', tokens: [{ id: 'p', prefix: '!', values: [] }], options: [{ value: 'x', label: 'X' }] }], run: vi.fn() }]} />);
      expect(announcer()).toBeNull();
      await userEvent.setup().keyboard('{Enter}');
      expect(announcer()?.textContent).toBe('');
      await userEvent.setup().type(screen.getByRole('combobox'), '!z');
      expect(announcer()?.textContent).toBe('"!z" is not valid');
    });
  });
});
