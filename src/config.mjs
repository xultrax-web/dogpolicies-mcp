// The one place the package's identity lives. Change a name here and every
// file, README snippet and server.json that reads it follows.
//
// Values can be overridden at runtime through the environment, so the same
// build works before the domain is final and after it moves.

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");

/** The npm package name, from package.json (the single config point). */
export const PACKAGE_NAME = pkg.name;
export const PACKAGE_VERSION = pkg.version;
/** The name in the official MCP Registry; package.json `mcpName` must match it. */
export const REGISTRY_NAME = pkg.mcpName;

/** The MCP server identity sent to clients. */
export const SERVER_NAME = "dogrulebook";
export const SERVER_TITLE = "Dog Rulebook";

/** Environment variable names, all prefixed so they never collide. */
export const ENV = {
  /** Base URL of the hosted site and API, e.g. https://dogrulebook.com */
  baseUrl: "DOGRULEBOOK_BASE_URL",
  /** "1" to never touch the network (no snapshot refresh, no reports). */
  offline: "DOGRULEBOOK_OFFLINE",
  /** Log level on stderr: silent, error, warn, info, debug. */
  log: "DOGRULEBOOK_LOG",
  /** Pin "today" (YYYY-MM-DD) so freshness is reproducible in tests. */
  today: "DOGRULEBOOK_TODAY",
  /** Directory for the cached snapshot; defaults to the OS cache dir. */
  cacheDir: "DOGRULEBOOK_CACHE_DIR",
  /** Path to a local snapshot file, for development and tests. */
  snapshot: "DOGRULEBOOK_SNAPSHOT",
};

/** Default base URL until the domain is final. Override with DOGRULEBOOK_BASE_URL. */
export const DEFAULT_BASE_URL = "https://dogrulebook.com";

/** Hostnames the package will talk to besides localhost, for the SSRF guard. */
export const ALLOWED_HOSTS = ["dogrulebook.com", "www.dogrulebook.com"];

/** Where the hosted site publishes the newest snapshot. */
export const SNAPSHOT_PATH = "/data/mcp-snapshot-v1.json";
/** The hosted Streamable HTTP endpoint (the same tools, served remotely). */
export const REMOTE_MCP_PATH = "/mcp/";
/** Where corrections are filed; the web form posts here too. */
export const CORRECTIONS_PATH = "/corrections/submit";

/** Snapshot format version lives beside the builder (it has no other imports). */
export { SNAPSHOT_SCHEMA } from "./snapshot/build.mjs";

/** Budgets. Text per tool result is what reaches a model's context. */
export const LIMITS = {
  resultCharacters: 25_000,
  fetchTimeoutMs: 8_000,
  fetchRetries: 2,
  reportsPerMinute: 5,
  maxSnapshotBytes: 64 * 1024 * 1024,
};
