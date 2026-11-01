// The data source: a bundled snapshot that always works (offline, first run,
// no config), a cached newer copy from an earlier run, and a background
// refresh from the hosted site when the network allows. Whatever is loaded
// is served; a failed refresh never breaks an answer.
//
// Order on load:  cache (if newer than bundled)  >  bundled.
// Then, unless offline:  GET remote with If-None-Match / If-Modified-Since,
// validate, swap in, write to cache.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { gunzipSync } from "node:zlib";
import { insideDir } from "./safety.mjs";

/** Reads a snapshot file, gzipped or plain, and parses it. */
export function readSnapshotFile(path) {
  const bytes = readFileSync(path);
  const text =
    bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b
      ? gunzipSync(bytes).toString("utf8")
      : bytes.toString("utf8");
  return JSON.parse(text);
}

/**
 * @param {object} options
 * @param {string} [options.bundledPath] path of the snapshot shipped in the package
 * @param {object} [options.bundled] the snapshot as an object, instead of a file
 * @param {string|null} options.remoteUrl full URL of the hosted snapshot, or null
 * @param {string|null} options.cacheDir directory for the cached copy, or null for none
 * @param {(raw: object) => object} options.validate throws on a bad snapshot, returns it
 * @param {(raw: object) => string} options.versionOf comparable version string (as_of)
 * @param {object} options.log
 * @param {typeof fetch} [options.fetch]
 * @param {number} [options.timeoutMs]
 * @param {number} [options.retries]
 * @param {number} [options.maxBytes]
 */
export function createSnapshotSource({
  bundledPath,
  bundled: bundledObject,
  remoteUrl,
  cacheDir,
  validate,
  versionOf,
  log,
  fetch = globalThis.fetch,
  timeoutMs = 8000,
  retries = 2,
  maxBytes = 64 * 1024 * 1024,
}) {
  const cachePath = cacheDir ? insideDir(cacheDir, "snapshot.json") : null;
  const metaPath = cacheDir ? insideDir(cacheDir, "snapshot.meta.json") : null;
  let current = null;
  let origin = "none";
  let refreshing = null;
  const listeners = new Set();

  const readMeta = () => {
    try {
      return metaPath && existsSync(metaPath)
        ? JSON.parse(readFileSync(metaPath, "utf8"))
        : {};
    } catch {
      return {};
    }
  };

  function load() {
    const bundled = validate(bundledObject ?? readSnapshotFile(bundledPath));
    current = bundled;
    origin = "bundled";
    if (cachePath && existsSync(cachePath)) {
      try {
        const cached = validate(readSnapshotFile(cachePath));
        if (versionOf(cached) > versionOf(bundled)) {
          current = cached;
          origin = "cache";
        }
      } catch (error) {
        log.warn(`cached snapshot ignored: ${error.message}`);
      }
    }
    log.debug(`snapshot ${versionOf(current)} loaded from ${origin}`);
    return current;
  }

  async function fetchOnce(headers) {
    const res = await fetch(remoteUrl, {
      headers: { Accept: "application/json", ...headers },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error",
    });
    if (res.status === 304) return { notModified: true };
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const length = Number(res.headers.get("content-length") ?? 0);
    if (length > maxBytes)
      throw new Error(`snapshot too large: ${length} bytes`);
    const text = await res.text();
    if (text.length > maxBytes)
      throw new Error(`snapshot too large: ${text.length} bytes`);
    return {
      raw: JSON.parse(text),
      etag: res.headers.get("etag"),
      lastModified: res.headers.get("last-modified"),
    };
  }

  /** Fetches the hosted snapshot and swaps it in when it is newer. Never throws. */
  async function refresh() {
    if (!remoteUrl || !fetch) return { updated: false, reason: "offline" };
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const meta = readMeta();
      const headers = {};
      if (meta.etag) headers["If-None-Match"] = meta.etag;
      else if (meta.lastModified)
        headers["If-Modified-Since"] = meta.lastModified;
      let lastError = null;
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const got = await fetchOnce(headers);
          if (got.notModified)
            return { updated: false, reason: "not_modified" };
          const next = validate(got.raw);
          if (versionOf(next) <= versionOf(current))
            return { updated: false, reason: "not_newer" };
          current = next;
          origin = "remote";
          if (cachePath) {
            try {
              mkdirSync(cacheDir, { recursive: true });
              const tmp = `${cachePath}.${process.pid}.tmp`;
              writeFileSync(tmp, JSON.stringify(got.raw));
              renameSync(tmp, cachePath);
              writeFileSync(
                metaPath,
                JSON.stringify({
                  etag: got.etag,
                  lastModified: got.lastModified,
                  fetchedAt: new Date().toISOString(),
                }),
              );
            } catch (error) {
              log.warn(`snapshot cache write skipped: ${error.message}`);
            }
          }
          log.info(`snapshot updated to ${versionOf(next)} from ${remoteUrl}`);
          for (const fn of listeners) fn(current);
          return { updated: true, version: versionOf(next) };
        } catch (error) {
          lastError = error;
          const retryable =
            !(error instanceof SyntaxError) && !/too large/.test(error.message);
          if (!retryable) break;
          if (attempt < retries)
            await new Promise((r) => setTimeout(r, 250 * 2 ** attempt));
        }
      }
      log.debug(`snapshot refresh skipped: ${lastError?.message ?? "unknown"}`);
      return { updated: false, reason: "error", error: lastError?.message };
    })().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  return {
    load,
    refresh,
    get current() {
      return current;
    },
    get origin() {
      return origin;
    },
    onUpdate: (fn) => listeners.add(fn),
  };
}
