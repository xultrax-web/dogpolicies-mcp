// The reusable core: everything a second MCP server needs that is not about
// dogs. See docs/mcp-architecture.md in the repository for how to build one.

export { createToolServer, wrapToolHandler, READ_ONLY, WRITE_ONCE } from "./server.mjs";
export { createHttpHandler, listen } from "./http.mjs";
export { createSnapshotSource, readSnapshotFile } from "./source.mjs";
export { createCitations, quoteBlock } from "./citation.mjs";
export { result, pageResult, stableStringify } from "./result.mjs";
export { ToolError, CODES, fail, toErrorResult } from "./errors.mjs";
export { createLogger, levelFromEnv } from "./log.mjs";
export { checkBaseUrl, isSafeId, insideDir } from "./safety.mjs";
export {
  freshnessOf,
  worstFreshness,
  californiaToday,
  daysBetween,
  FRESHNESS,
} from "./freshness.mjs";
export { miles, nearestOnLine } from "./geo.mjs";
export { Lru } from "./lru.mjs";
