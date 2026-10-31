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

/** The brand every citation names; record links come from the data itself. */
export const BRAND = {
  name: "DogPolicies",
  url: "https://dogpolicies.com",
  license: {
    name: "CC BY 4.0",
    url: "https://creativecommons.org/licenses/by/4.0/",
  },
};

/** The MCP server identity sent to clients. */
export const SERVER_NAME = "dogpolicies";
export const SERVER_TITLE = "DogPolicies";

/** Environment variable names, all prefixed so they never collide. */
export const ENV = {
  /** Base URL of the hosted site and API, e.g. https://dogpolicies.com */
  baseUrl: "DOGPOLICIES_BASE_URL",
  /** "1" to never touch the network (no snapshot refresh, no reports). */
  offline: "DOGPOLICIES_OFFLINE",
  /** Log level on stderr: silent, error, warn, info, debug. */
  log: "DOGPOLICIES_LOG",
  /** Pin "today" (YYYY-MM-DD) so freshness is reproducible in tests. */
  today: "DOGPOLICIES_TODAY",
  /** Directory for the cached snapshot; defaults to the OS cache dir. */
  cacheDir: "DOGPOLICIES_CACHE_DIR",
  /** Path to a local snapshot file, for development and tests. */
  snapshot: "DOGPOLICIES_SNAPSHOT",
};

/**
 * The site the server refreshes its data from and files corrections to.
 * dogpolicies.com is ours (bought 2026-10-31). Until the site is deployed
 * there, the refresh fails fast and silently and the bundled data serves;
 * nothing else changes. DOGPOLICIES_BASE_URL overrides; DOGPOLICIES_OFFLINE=1
 * turns the network off.
 */
export const DEFAULT_BASE_URL = "https://dogpolicies.com";

/**
 * Hostnames the package may talk to besides localhost: our domain only, so a
 * typo in the environment cannot point the server elsewhere.
 */
export const ALLOWED_HOSTS = ["dogpolicies.com", "www.dogpolicies.com"];

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
  fetchTimeoutMs: 5_000,
  fetchRetries: 2,
  reportsPerMinute: 5,
  maxSnapshotBytes: 64 * 1024 * 1024,
};
