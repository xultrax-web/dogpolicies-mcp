// The error model every tool shares. A tool never throws at a client: it
// returns a result with `isError`, a stable code the client can branch on,
// and a message a person can read. Unknown exceptions become `internal`
// without leaking a stack trace.

/** Stable error codes. Add codes; never rename one. */
export const CODES = Object.freeze({
  not_found: "not_found",
  invalid: "invalid",
  rate_limited: "rate_limited",
  unavailable: "unavailable",
  offline: "offline",
  internal: "internal",
});

export class ToolError extends Error {
  /**
   * @param {keyof typeof CODES} code
   * @param {string} message
   * @param {object} [extra] fields merged into structuredContent.error
   */
  constructor(code, message, extra = {}) {
    super(message);
    this.name = "ToolError";
    this.code = CODES[code] ?? CODES.internal;
    this.extra = extra;
  }
}

/** A tool result that reports an error the client can act on. */
export function fail(code, message, extra = {}) {
  return {
    content: [{ type: "text", text: message }],
    structuredContent: {
      error: { code: CODES[code] ?? "internal", message, ...extra },
    },
    isError: true,
  };
}

/** Turns any thrown value into an error result; ToolError keeps its code. */
export function toErrorResult(error, { log } = {}) {
  if (error instanceof ToolError)
    return fail(error.code, error.message, error.extra);
  log?.error?.(`tool failed: ${error?.stack ?? error}`);
  return fail(
    "internal",
    "The server hit an unexpected error; try again or report it.",
  );
}
