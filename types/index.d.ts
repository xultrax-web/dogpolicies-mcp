// Type declarations for the library entry. The CLI needs none of this; it is
// for people who embed the server or build on the core.

import type { McpServer } from "@modelcontextprotocol/server";

export interface RuntimeOverrides {
  /** Never touch the network. */
  offline?: boolean;
  /** https URL of the site; must be an allowed host or localhost. */
  baseUrl?: string;
  logLevel?: "silent" | "error" | "warn" | "info" | "debug";
  cacheDir?: string;
  /** A snapshot file (.json or .json.gz) instead of the bundled one. */
  snapshotPath?: string;
  /** Returns today as YYYY-MM-DD; used for freshness. */
  today?: () => string;
  fetch?: typeof fetch;
}

export interface Runtime {
  readonly graph: {
    as_of: string;
    places: unknown[];
    brands: unknown[];
    site: { name: string; url: string; license: { name: string; url: string } };
  };
  today: () => string;
  config: { offline: boolean; baseUrl: string; cacheDir: string };
  source: { refresh(): Promise<{ updated: boolean }>; readonly origin: string };
  log: {
    info(m: string): void;
    warn(m: string): void;
    error(m: string): void;
    debug(m: string): void;
  };
}

export function createRuntime(options?: {
  env?: NodeJS.ProcessEnv;
  overrides?: RuntimeOverrides;
}): Runtime;
export function createServer(
  ctx: Runtime,
  options?: { onToolCall?: (name: string, ctx: unknown) => unknown },
): McpServer;
export function readConfig(options?: {
  env?: NodeJS.ProcessEnv;
  overrides?: RuntimeOverrides;
}): Runtime["config"];
export function toolDefinitions(
  ctx: Runtime,
): Array<{ name: string; title: string; description: string }>;
export function connectInProcess(
  ctx: Runtime,
): Promise<{ client: unknown; server: McpServer; close(): Promise<void> }>;
export function createHttpHandler(
  factory: () => McpServer,
  options?: { path?: string; allowedHosts?: string[] },
): { fetch(request: Request): Promise<Response>; path: string };
export function listen(
  handler: { fetch(request: Request): Promise<Response>; path: string },
  options?: { port?: number; host?: string },
): Promise<{ url: string; port: number; close(): Promise<void> }>;

export const PACKAGE_NAME: string;
export const PACKAGE_VERSION: string;
export const REGISTRY_NAME: string;
export const DEFAULT_BASE_URL: string;
export const ENV: Record<
  "baseUrl" | "offline" | "log" | "today" | "cacheDir" | "snapshot",
  string
>;
