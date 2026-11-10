// Place names as people say them, read one way everywhere: the tools'
// resolveTown (common.mjs) and the website's /near/ and /search/ pages, which
// run this file in the browser over /data/names-v1.json (src/lib/place-names.mjs,
// docs/DECISIONS.md, 120). It imports nothing, so it can go anywhere.
//
// A gazetteer is the snapshot's towns (areas, cities and counties, most places
// first), the regions with their centers, and the AIRPORTS and NEIGHBORHOODS
// tables in common.mjs. resolveName reads a name against it in a fixed order:
// exact area, city, county; area id; region; airport; neighborhood; then a
// prefix of an area, city or county; then a one- or two-letter slip.

/** The search radius around an airport when the caller gives none. */
export const AIRPORT_RADIUS_MILES = 5;

/** "Carmel-by-the-Sea" and "carmel by the sea" are one key: lower case, with dots, commas, underscores and hyphens read as spaces. */
export const nameKey = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[.,_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Every name an airport answers to: its code, "<code> airport", its name, and its aliases. */
export function airportNames(a) {
  return [
    a.code,
    `${a.code} airport`,
    a.name,
    a.name.replace(/ airport$/i, ""),
    ...(a.aliases ?? []),
  ];
}

/**
 * Each region with the center and states of its located places, the way a
 * region resolves: { id, name, lat, lon, state, states }; lat is null for a
 * region with no located place (it then never resolves).
 * @param {{ id: string, name: string }[]} regions
 * @param {{ regionId?: string, geo?: { lat: number, lon: number }, state: string }[]} places
 */
export function regionCenters(regions, places) {
  return regions.map((r) => {
    const members = places.filter((p) => p.regionId === r.id && p.geo);
    if (!members.length)
      return {
        id: r.id,
        name: r.name,
        lat: null,
        lon: null,
        state: null,
        states: [],
      };
    const lat = members.reduce((s, p) => s + p.geo.lat, 0) / members.length;
    const lon = members.reduce((s, p) => s + p.geo.lon, 0) / members.length;
    return {
      id: r.id,
      name: r.name,
      lat: Math.round(lat * 1e4) / 1e4,
      lon: Math.round(lon * 1e4) / 1e4,
      state: members[0].state,
      states: [...new Set(members.map((p) => p.state))],
    };
  });
}

/**
 * The lookups resolveName reads, built once per data set.
 * @param {{ towns?: object[], regions?: object[], airports?: object[], neighborhoods?: object[] }} parts
 *   towns: { name, kind: "area"|"city"|"county", state, lat, lon, id? }, most places first;
 *   regions: from regionCenters; airports and neighborhoods: the tables in common.mjs
 */
export function gazetteer({
  towns = [],
  regions = [],
  airports = [],
  neighborhoods = [],
}) {
  const exact = new Map();
  const keys = new Map();
  for (const t of towns) {
    const n = nameKey(t.name);
    keys.set(t, n);
    const k = `${t.kind}|${n}`;
    if (!exact.has(k)) exact.set(k, []);
    exact.get(k).push(t);
  }
  return {
    towns,
    regions,
    exact,
    keys,
    airports: airports.map((a) => ({
      a,
      keys: new Set(airportNames(a).map(nameKey)),
    })),
    neighborhoods: neighborhoods.map((n) => ({
      n,
      keys: new Set([nameKey(n.name), ...(n.aliases ?? []).map(nameKey)]),
    })),
  };
}

/**
 * Resolves "Monterey", "Monterey, CA", "Washoe County NV", "Lake Tahoe",
 * "Koreatown", "DTLA", "SFO" or "Montery" to a search center: { name, kind,
 * state, county, lat, lon } (kind area, region, city, county or airport; an
 * airport adds code and radius_miles, a corrected slip corrected_from), or null.
 */
export function resolveName(gaz, text, { exact: exactOnly = false } = {}) {
  const raw = nameKey(text);
  if (!raw) return null;
  let state = null;
  let name = raw;
  const m = raw.match(/^(.*?)\s+(ca|nv|california|nevada)$/);
  if (m) {
    name = m[1].trim();
    state = m[2].startsWith("ca") ? "CA" : "NV";
  }
  name = name.replace(/\s+county$/, "");
  const towns = state ? gaz.towns.filter((t) => t.state === state) : gaz.towns;
  const exact = (kind) =>
    (gaz.exact.get(`${kind}|${name}`) ?? []).find(
      (t) => !state || t.state === state,
    );
  const starts = (kind) =>
    towns.find((t) => t.kind === kind && gaz.keys.get(t).startsWith(name));
  // Exact names first, areas before cities ("Lake Tahoe" is the trip, not a
  // town), then an area id, then prefixes. `exact` stops before the prefixes
  // and slips: a name elsewhere ("Phoenix") must not lose to a covered prefix.
  const whole =
    exact("area") ??
    exact("city") ??
    exact("county") ??
    towns.find((t) => t.kind === "area" && t.id === name) ??
    region(gaz, name, state) ??
    airport(gaz, name, state) ??
    neighborhood(gaz, name, state);
  if (whole || exactOnly) return whole ?? null;
  return (
    starts("area") ??
    starts("city") ??
    starts("county") ??
    typo(towns, name) ??
    null
  );
}

/** The airport a whole text names ("LAX", "LAX airport", "Harry Reid"), as resolveName returns it, or null. */
export function findAirport(gaz, text) {
  const raw = nameKey(text);
  return raw ? airport(gaz, raw, null) : null;
}

/** A region ("Central Valley", "central-valley") as a scope of its member places; its center is their middle. */
function region(gaz, name, state) {
  const r = gaz.regions.find(
    (x) => x.name.toLowerCase() === name || x.id.replace(/-/g, " ") === name,
  );
  if (!r || r.lat == null) return null;
  if (state && !r.states.includes(state)) return null;
  return {
    name: r.name,
    kind: "region",
    id: r.id,
    county: null,
    state: r.state,
    lat: r.lat,
    lon: r.lon,
  };
}

/** An airport by code, name or alias, as a search center with its own default radius. */
function airport(gaz, name, state) {
  const a = gaz.airports.find(
    (x) => (!state || x.a.state === state) && x.keys.has(name),
  )?.a;
  if (!a) return null;
  return {
    name: a.name,
    code: a.code,
    kind: "airport",
    county: a.county,
    state: a.state,
    lat: a.lat,
    lon: a.lon,
    radius_miles: a.radius_miles ?? AIRPORT_RADIUS_MILES,
  };
}

/** A neighborhood of a city we cover, as a search center. */
function neighborhood(gaz, name, state) {
  const n = gaz.neighborhoods.find(
    (x) => x.keys.has(name) && (!state || x.n.state === state),
  )?.n;
  if (!n) return null;
  const { aliases: _aliases, ...center } = n;
  return { ...center, kind: "city" };
}

/**
 * A one- or two-letter slip in a town or county name ("Montery", "Sacremento"):
 * the closest name, marked corrected_from so the answer can say so. Short
 * words and anything further off are left unmatched.
 */
function typo(towns, name) {
  if (name.length < 5) return null;
  const limit = name.length < 9 ? 1 : 2;
  let best = null;
  for (const t of towns) {
    if (t.kind !== "city" && t.kind !== "county") continue;
    const d = editDistance((t.name ?? "").toLowerCase(), name, limit);
    // closest first; at the same distance a city beats a county ("Montery" is the town)
    const better =
      !best ||
      d < best.d ||
      (d === best.d && t.kind === "city" && best.t.kind !== "city");
    if (d <= limit && better) best = { t, d };
  }
  return best ? { ...best.t, corrected_from: name } : null;
}

/** Levenshtein distance, stopping early once it passes `limit`. */
export function editDistance(a, b, limit) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let low = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      low = Math.min(low, cur[j]);
    }
    if (low > limit) return limit + 1;
    prev = cur;
  }
  return prev[b.length];
}
