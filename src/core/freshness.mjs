// Freshness is a function of today, so a snapshot built in October must not
// say "fresh" in March. Every rule carries verifiedAt and reviewDue; the
// state is computed at call time from those and the date.

export const FRESHNESS = ["fresh", "due", "stale", "unreadable"];
const RANK = { fresh: 0, due: 1, stale: 2, unreadable: 3 };

export const daysBetween = (a, b) =>
  Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/**
 * "fresh" inside the review interval, "due" past it, "stale" past twice it,
 * "unreadable" when the last check could not read the source, whatever the
 * date. The interval is reviewDue minus verifiedAt.
 */
export function freshnessOf({ verifiedAt, reviewDue, unreadable }, today) {
  if (unreadable) return "unreadable";
  const interval = Math.max(1, daysBetween(verifiedAt, reviewDue));
  const age = daysBetween(verifiedAt, today);
  if (age > 2 * interval) return "stale";
  if (age > interval) return "due";
  return "fresh";
}

export const worstFreshness = (states) =>
  states.reduce((w, s) => (RANK[s] > RANK[w] ? s : w), "fresh");

/** Today as a California date, or the pinned date from the environment. */
export function californiaToday(
  env = process.env,
  envName = "DOGPOLICIES_TODAY",
) {
  const pinned = env[envName];
  if (pinned && /^\d{4}-\d{2}-\d{2}$/.test(pinned)) return pinned;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
  }).format(new Date());
}
