// The change feeds' addresses (roadmap R-34), shared by the feed service, the
// subscribe tool and the site's pages. A feed URL carries its whole scope.

export const FEED_PREFIX = "/feeds/changes/";
export const DEFAULT_RADIUS = 15;

/** "Lake Tahoe" -> "lake-tahoe"; "Washoe County, NV" -> "washoe-county-nv". */
export const feedSlug = (text) =>
  String(text ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/**
 * The feed path for a scope, without extension or with `.atom`/`.json`.
 * @param {{ kind: "place"|"near"|"route", id: string, radius?: number|null, from?: number|null, to?: number|null }} scope
 */
export function feedPath(scope, ext) {
  const q = new URLSearchParams();
  if (
    scope.kind === "near" &&
    scope.radius != null &&
    scope.radius !== DEFAULT_RADIUS
  )
    q.set("radius", String(scope.radius));
  if (scope.kind === "route") {
    if (scope.from != null) q.set("from", String(scope.from));
    if (scope.to != null) q.set("to", String(scope.to));
  }
  const query = q.toString();
  return `${FEED_PREFIX}${scope.kind}/${encodeURIComponent(scope.id)}${ext ? `.${ext}` : ""}${query ? `?${query}` : ""}`;
}

/** Both feed URLs for a scope, absolute. */
export function feedUrls(siteUrl, scope) {
  const root = String(siteUrl).replace(/\/+$/, "");
  return {
    atom: `${root}${feedPath(scope, "atom")}`,
    json: `${root}${feedPath(scope, "json")}`,
  };
}

/** The feed slug for a resolved town (scope.mjs): the name, and the state for a city or county. */
export function townSlug(town) {
  if (!town) return null;
  if (town.kind === "area" || town.kind === "region")
    return feedSlug(town.name);
  if (town.kind === "county")
    return feedSlug(`${town.name} county ${town.state ?? ""}`);
  return feedSlug(`${town.name} ${town.state ?? ""}`);
}

/** Today minus `days`, as YYYY-MM-DD. */
export function daysBefore(today, days) {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}
