// Sends a correction report to the hosted inbox. One POST, JSON in, JSON
// out, with a timeout and a client-side rate limit so a runaway agent cannot
// flood the inbox. The only data sent is the report itself.

/**
 * @param {object} options
 * @param {string} options.endpoint full URL of the corrections endpoint
 * @param {number} [options.perMinute]
 * @param {number} [options.timeoutMs]
 * @param {typeof fetch} [options.fetch]
 * @param {() => number} [options.now]
 */
export function createReporter({
  endpoint,
  perMinute = 5,
  timeoutMs = 10_000,
  fetch = globalThis.fetch,
  now = Date.now,
}) {
  let windowStart = 0;
  let inWindow = 0;
  return {
    underLimit() {
      const t = now();
      if (t - windowStart > 60_000) {
        windowStart = t;
        inWindow = 0;
      }
      return ++inWindow <= perMinute;
    },
    async send({ placeId, message, sourceUrl, contact }) {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            kind: "correction",
            placeId,
            message,
            sourceUrl: sourceUrl ?? "",
            contact: contact ?? "",
            via: "mcp-npm",
          }),
          signal: AbortSignal.timeout(timeoutMs),
          redirect: "error",
        });
        if (res.status === 429)
          return { ok: false, reason: "rate limited by the site" };
        if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
        const type = res.headers.get("content-type") ?? "";
        if (!type.includes("json"))
          return { ok: false, reason: "unexpected answer" };
        const body = await res.json();
        if (!body?.id)
          return { ok: false, reason: body?.error ?? "no report id" };
        return { ok: true, id: String(body.id) };
      } catch (error) {
        return {
          ok: false,
          reason: error.name === "TimeoutError" ? "timed out" : "network error",
        };
      }
    },
  };
}
