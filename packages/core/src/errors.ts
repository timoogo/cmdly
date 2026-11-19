// ---------------------------------------------------------------------------
// Stable error codes
// ---------------------------------------------------------------------------

export type CmdlyErrorCode =
  | 'TAG_CONFLICT'
  | 'UNKNOWN_TAG'
  | 'INVALID_TAG_OVERRIDE'
  | 'COMMAND_UNAVAILABLE'
  | 'INVALID_TOKEN_TYPE'
  | 'INVALID_TOKEN_MATCH';

/** Details carried by each error code. */
export type CmdlyErrorDetails = {
  TAG_CONFLICT: { tag: string; registries: string[] };
  UNKNOWN_TAG: { tag: string; commandId: string; allowedTags: string[] };
  INVALID_TAG_OVERRIDE: { tag: string; commandId: string };
  COMMAND_UNAVAILABLE: { qualifiedId: string };
  INVALID_TOKEN_TYPE: { typeId: string; reason: string };
  INVALID_TOKEN_MATCH: { typeId: string; value: string; result: unknown };
};

/**
 * Base error class for all Cmdly runtime errors.
 * Carries a stable `code`, typed `details`, and an optional `cause`.
 */
export class CmdlyError<TCode extends CmdlyErrorCode = CmdlyErrorCode> extends Error {
  readonly code: TCode;
  readonly details: CmdlyErrorDetails[TCode];

  constructor(code: TCode, message: string, details: CmdlyErrorDetails[TCode], cause?: unknown) {
    super(message);
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
    this.name = 'CmdlyError';
    this.code = code;
    this.details = details;
    // Maintain proper prototype chain
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Keeps the existing CommandUnavailableError for backward compatibility. */
export class CommandUnavailableError extends CmdlyError<'COMMAND_UNAVAILABLE'> {
  constructor(readonly qualifiedId: string) {
    super(
      'COMMAND_UNAVAILABLE',
      `Registry command is no longer available: ${qualifiedId}`,
      { qualifiedId },
    );
    this.name = 'CommandUnavailableError';
    Object.setPrototypeOf(this, CommandUnavailableError.prototype);
  }
}
