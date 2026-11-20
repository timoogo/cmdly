import { useCallback } from 'react';
import type { ReactNode } from 'react';
import type { EngineOptions, TokenOptions } from '@cmdly/core';
import { useClosedEngine, useCommandSession, type CommandSessionEngine } from './session.js';

/** The interface creates one engine per opening from these options and destroys it when it closes. */
export type OwnedEngineProps = Pick<EngineOptions, 'commands' | 'defaults' | 'callbacks' | 'strategies' | 'plugins'> & {
  /** Global token types and collision resolver. Changes are applied to the open interface. */
  tokens?: TokenOptions;
  engine?: never;
};

/**
 * The interface displays a session owned by the caller (plain or registry engine). It never closes or destroys it:
 * Escape, Cancel and the final step's `close` only call `onOpenChange(false)`, and the session — query, path,
 * tokens, a running command — is kept for the next interface. Configure the engine itself (commands, tokens,
 * callbacks, plugins; `refreshRegistry()` after registry changes). When the engine closes (`engine.close()`,
 * completion), `onOpenChange(false)` is called and the engine cannot be shown again: create a new one.
 */
export type ExternalEngineProps = {
  /** A plain engine (`createCommandEngine({ commands })`) or a registry engine (`createCommandEngine({ registry })`). */
  engine: CommandSessionEngine;
  commands?: never; defaults?: never; callbacks?: never; strategies?: never; plugins?: never; tokens?: never;
};

/** What a container needs to display a session, whoever owns it. */
export type HostedSession = {
  engine: CommandSessionEngine;
  /** UI-only dismissal for external engines; `undefined` lets the combobox close an owned engine. */
  onDismiss?: () => void;
};

type SessionHostProps = (OwnedEngineProps | ExternalEngineProps) & {
  onOpenChange: (open: boolean) => void;
  children: (session: HostedSession) => ReactNode;
};

/**
 * Internal. Resolves the session of an open interface (owned or external engine), keeps the interface's open
 * state in sync with an engine that closes, and renders the container through `children`.
 */
export function SessionHost(props: SessionHostProps) {
  return props.engine ? <ExternalHost {...props} engine={props.engine} /> : <OwnedHost {...props as OwnedEngineProps & SessionHostProps} />;
}

function OwnedHost({ commands, defaults, callbacks, strategies, plugins, tokens, onOpenChange, children }: OwnedEngineProps & SessionHostProps) {
  const engine = useCommandSession({ commands, defaults, callbacks, strategies, plugins, tokens });
  const onClosed = useCallback(() => onOpenChange(false), [onOpenChange]);
  useClosedEngine(engine, onClosed);
  return <>{children({ engine })}</>;
}

function ExternalHost({ engine, onOpenChange, children }: SessionHostProps & { engine: CommandSessionEngine }) {
  const onClosed = useCallback(() => onOpenChange(false), [onOpenChange]);
  useClosedEngine(engine, onClosed);
  return <>{children({ engine, onDismiss: onClosed })}</>;
}
