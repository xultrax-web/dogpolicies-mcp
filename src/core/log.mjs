// Logging to stderr only (stdout is the MCP wire on stdio), with levels, and
// nothing sent anywhere. No telemetry exists in this package: the logger is
// the only place anything is written, and it is the user's own terminal.
//
// Tool arguments and results are never logged above `debug`, so a normal
// run shows what the server did, not what the user asked.

const LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };

/**
 * @param {object} [options]
 * @param {string} [options.level] silent | error | warn | info | debug
 * @param {string} [options.prefix]
 * @param {(line: string) => void} [options.write] defaults to stderr
 */
export function createLogger({
  level = "info",
  prefix = "",
  write = (line) => process.stderr.write(line + "\n"),
} = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info;
  const emit = (name) => (message) => {
    if (LEVELS[name] > threshold) return;
    write(`${prefix ? `${prefix} ` : ""}${name}: ${message}`);
  };
  return {
    level,
    error: emit("error"),
    warn: emit("warn"),
    info: emit("info"),
    debug: emit("debug"),
    child: (childPrefix) =>
      createLogger({
        level,
        prefix: [prefix, childPrefix].filter(Boolean).join(" "),
        write,
      }),
  };
}

/** The level named in the environment, or the default. */
export const levelFromEnv = (value, fallback = "info") =>
  value && value in LEVELS ? value : fallback;
