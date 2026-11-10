import { LIMITS } from "../../config.mjs";
import {
  closureFor,
  closureLine,
  usableClosures,
} from "../vendor/closures.mjs";

export const CONDITIONS_PATH = "/api/v1/conditions/i-5.json";
/** The closures a tool adds to its stops are read within this time, or left out. */
const SIDE_READ_MS = 1_500;
/** A stdio server keeps the document it fetched this long (the loop rebuilds it every 15 minutes). */
const NETWORK_TTL_MS = 5 * 60_000;

/**
 * Where the I-5 conditions document comes from: the hosted Worker's loader
 * (ctx.conditions, in-process, already cached for five minutes), else the
 * site over the network when the server may use it, else nothing.
 * Returns `async () => doc | null` (it throws on a failed read) or null.
 */
export function conditionsSource(ctx) {
  return (
    ctx.conditions ??
    (ctx.config.network
      ? async () => {
          const res = await ctx.config.fetch(
            `${ctx.config.baseUrl}${CONDITIONS_PATH}`,
            {
              headers: { Accept: "application/json" },
              signal: AbortSignal.timeout(LIMITS.fetchTimeoutMs ?? 10_000),
            },
          );
          if (!res.ok)
            throw new Error(
              `the conditions document answered HTTP ${res.status}`,
            );
          const doc = await res.json();
          return doc?.error ? null : doc;
        }
      : null)
  );
}

const memo = new WeakMap();

/**
 * The usable closures for a tool that decorates its stops, or null. Never
 * throws and never waits long: a missing, failed, slow, malformed or stale
 * document is "no closures known", and the tool answers exactly as before.
 * The hosted loader is cached upstream; the stdio fetch is kept five minutes
 * (a failure one minute) so a run of calls pays at most one read.
 */
export async function closuresFor(ctx, now = Date.now()) {
  const source = conditionsSource(ctx);
  if (!source) return null;
  const held = memo.get(ctx);
  if (!ctx.conditions && held && now - held.at < held.ttl) return held.usable;
  let usable = null;
  let ok = false;
  try {
    let timer;
    const doc = await Promise.race([
      source(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("slow")), SIDE_READ_MS);
      }),
    ]).finally(() => clearTimeout(timer));
    usable = usableClosures(doc, now);
    ok = true;
  } catch {
    usable = null;
  }
  if (!ctx.conditions)
    memo.set(ctx, { usable, at: now, ttl: ok ? NETWORK_TTL_MS : 60_000 });
  return usable;
}

/** The direction a rest-area stop serves, from the route's `side`. */
export const dirOfStop = (x) =>
  x.side === "ahead" ? "northbound" : x.side === "back" ? "southbound" : null;

/** closed_now for one I-5 route stop (a rest area), or null. */
export function closedNowOf(x, usable, now = Date.now()) {
  if (!usable || x.place?.type !== "rest_area" || x.s_m == null) return null;
  return closureFor({ s: x.s_m, dir: dirOfStop(x) }, usable, now);
}

/** The sentence for a closed stop in an answer's text. */
export const closedWords = (name, closed) => `${name}: ${closureLine(closed)}.`;
