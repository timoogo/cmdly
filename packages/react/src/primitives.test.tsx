// @vitest-environment jsdom
// Boundaries of the internal primitives extracted from the palette (not public API yet).
import React, { StrictMode, useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Command, CommandEngine } from '@cmdly/core';
import { useClosedEngine, useCommandSession, type CommandSessionOptions } from './session.js';
import { useCommandCombobox } from './combobox.js';

afterEach(cleanup);

const alive = (engine: CommandEngine) => {
  let notified = 0;
  const off = engine.subscribe(() => { notified++; });
  engine.setQuery(String(Math.random()));
  off();
  return notified > 0;
};
const flush = () => act(async () => { await Promise.resolve(); });

describe('useCommandSession', () => {
  const commands: Command[] = [{ id: 'a', label: 'Alpha', run: vi.fn() }];

  it('keeps one engine across rerenders, syncs options and destroys it on unmount', async () => {
    const { result, rerender, unmount } = renderHook((props: CommandSessionOptions) => useCommandSession(props), { initialProps: { commands } });
    const engine = result.current;
    rerender({ commands: [{ id: 'b', label: 'Beta', run: vi.fn() }] });
    expect(result.current).toBe(engine);
    expect(engine.getSnapshot().items.map(item => item.label)).toEqual(['Beta']);
    unmount();
    await flush();
    expect(alive(engine)).toBe(false);
  });

  it('survives the StrictMode effect replay', async () => {
    const setup = vi.fn();
    const { result } = renderHook(() => useCommandSession({ commands, plugins: [{ setup }] }), { wrapper: StrictMode });
    await flush();
    expect(alive(result.current)).toBe(true);
    expect(setup).toHaveBeenCalledTimes(2);
  });

  it('reports closing once the engine is closed', async () => {
    const onClosed = vi.fn();
    const { result } = renderHook(() => { const engine = useCommandSession({ commands }); useClosedEngine(engine, onClosed); return engine; });
    act(() => result.current.close());
    await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
  });
});

describe('useCommandCombobox', () => {
  // A custom view built only from the primitives, without the palette's markup or container.
  function Custom({ commands, onClosed }: { commands: Command[]; onClosed: () => void }) {
    const root = useRef<HTMLDivElement>(null);
    const engine = useCommandSession({ commands });
    useClosedEngine(engine, onClosed);
    const { inputProps, listboxProps, getOptionProps, visibleItems, onKeyDown, listVisible } = useCommandCombobox(engine, { root, tokensConfigured: false, tokenFeedback: 'banner' });
    return <section ref={root} onKeyDown={onKeyDown}>
      <input aria-label="Commands" {...inputProps} />
      {listVisible && <ol {...listboxProps}>{visibleItems.map(({ item, index }) => <li key={index} {...getOptionProps(index)}>{item.label}</li>)}</ol>}
    </section>;
  }

  it('provides keyboard interaction and ARIA wiring to a custom view', async () => {
    const user = userEvent.setup(), first = vi.fn(), second = vi.fn();
    render(<Custom commands={[{ id: 'a', label: 'Alpha', run: first }, { id: 'b', label: 'Beta', run: second }]} onClosed={() => {}} />);
    const input = screen.getByRole('combobox');
    expect(document.activeElement).toBe(input); // initial focus comes from the phase effect
    expect(input.getAttribute('aria-controls')).toBe(screen.getByRole('listbox').id);
    await user.keyboard('{ArrowDown}');
    expect(input.getAttribute('aria-activedescendant')).toBe(screen.getByRole('option', { name: 'Beta' }).id);
    expect(screen.getByRole('option', { name: 'Beta' }).getAttribute('aria-selected')).toBe('true');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(second).toHaveBeenCalledTimes(1));
    expect(first).not.toHaveBeenCalled();
  });

  it('selects with the pointer and closes with Escape', async () => {
    const user = userEvent.setup(), run = vi.fn(), onClosed = vi.fn();
    const view = render(<Custom commands={[{ id: 'a', label: 'Alpha', run }, { id: 'b', label: 'Beta', run: vi.fn() }]} onClosed={onClosed} />);
    await user.click(screen.getByRole('option', { name: 'Alpha' }));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1)); // closes after a successful run
    view.unmount();
    const escaped = vi.fn();
    render(<Custom commands={[{ id: 'a', label: 'Alpha', run }]} onClosed={escaped} />);
    expect(escaped).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(escaped).toHaveBeenCalledTimes(1));
  });
});
