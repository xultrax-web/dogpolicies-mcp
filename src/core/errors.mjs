// The error model every tool shares. A tool never throws at a client. Two
// kinds of result leave a tool:
//
//   an answer    the server did its work; `outcome` says what it found. A
//                place that is not in the data, an argument that cannot be
//                used as given, a live feed that could not be read: each is
//                an answer with suggestions (did_you_mean, nearest, next),
//                never a dead end and never `isError`.
//   an error     the server itself failed (`internal`) or refused a write
//                (`rate_limited`): `isError` with a stable code.
//
// Directories count every `isError` result against a server, whatever the
// code, so the line between the two is drawn at "did the server break".
// Unknown exceptions become `internal` without leaking a stack trace.

/** What a normal answer found. Absent or "ok" is the usual case. */
export const OUTCOMES = Object.freeze({
  ok: "ok",
  /** Some of what was asked for was found; `missing` names the rest. */
  partial: "partial",
  /** Nothing in the data matches; see did_you_mean, nearest and next. */
  no_match: "no_match",
  /** The arguments cannot be used as given; `next` says what would work. */
  bad_input: "bad_input",
  /** A live source could not be read; the data is not the problem. */
  unavailable: "unavailable",
});

/**
 * An answer that is not an error. `shape` holds whatever the tool's output
 * contract requires (empty lists, zero counts, nulls), so the result passes
 * the output schema; the outcome fields say what happened; `text` is the
 * markdown a person reads (the message when none is given).
 */
export function answer({
  outcome,
  code = null,
  message,
  shape = {},
  did_you_mean,
  nearest,
  missing,
  next,
  format = "markdown",
  text,
}) {
  const data = {
    ...shape,
    outcome,
    ...(code ? { code } : {}),
    message,
    ...(did_you_mean ? { did_you_mean } : {}),
    ...(nearest ? { nearest } : {}),
    ...(missing ? { missing } : {}),
    ...(next?.length ? { next } : {}),
  };
  return {
    content: [
      {
        type: "text",
        text:
          format === "json" ? JSON.stringify(data, null, 2) : (text ?? message),
      },
    ],
    structuredContent: data,
  };
}

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
