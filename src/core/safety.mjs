// Guards at the edges: the configurable base URL cannot be turned into a
// request to an arbitrary host (SSRF), ids cannot reach the filesystem
// (path traversal), and cache files stay inside the cache directory.

import { resolve, sep } from "node:path";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Validates a base URL: https to an allowed host, or http(s) to localhost
 * for development. No credentials, no query, no fragment. Returns the
 * normalized origin plus path without a trailing slash.
 */
export function checkBaseUrl(input, { allowedHosts = [] } = {}) {
  let url;
  try {
    url = new URL(String(input));
  } catch {
    throw new Error(
      `base URL is not a valid URL: ${JSON.stringify(String(input))}`,
    );
  }
  if (url.username || url.password)
    throw new Error("base URL must not carry credentials");
  if (url.search || url.hash)
    throw new Error("base URL must not carry a query or fragment");
  const host = url.hostname.toLowerCase();
  const local = LOCAL_HOSTS.has(host) || host.endsWith(".localhost");
  if (local) {
    if (!["http:", "https:"].includes(url.protocol))
      throw new Error("base URL must be http or https");
  } else {
    if (url.protocol !== "https:") throw new Error("base URL must use https");
    if (
      /^[\d.]+$|^\[/.test(host) ||
      /\.(local|internal|localdomain)$/.test(host)
    )
      throw new Error("base URL must name a public host, not an address");
    if (allowedHosts.length && !allowedHosts.includes(host))
      throw new Error(
        `base URL host ${host} is not allowed; allowed: ${allowedHosts.join(", ")}`,
      );
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

/** A record id: lowercase letters, digits and hyphens only. */
export const isSafeId = (id) =>
  typeof id === "string" && /^[a-z0-9][a-z0-9-]{0,119}$/.test(id);

/** A path inside `dir`, or throws. Guards against "../" in a cache key. */
export function insideDir(dir, name) {
  const root = resolve(dir);
  const path = resolve(root, name);
  if (path !== root && !path.startsWith(root + sep))
    throw new Error(`path escapes ${root}: ${name}`);
  return path;
}
