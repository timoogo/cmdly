export class CommandUnavailableError extends Error {
  constructor(readonly qualifiedId: string) { super(`Registry command is no longer available: ${qualifiedId}`); this.name = 'CommandUnavailableError'; }
}
