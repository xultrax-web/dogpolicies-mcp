// Shared pieces of the DogPolicies tools: the place summary every list
// returns, the markdown line for it, the input schema fragments, location
// filtering and the list responder. A tool file imports from here and from
// the core; it never reaches into the snapshot format on its own.

import * as z from "zod/v4";
import { LIMITS } from "../../config.mjs";
import { answer } from "../../core/errors.mjs";
import { pageResult, result } from "../../core/result.mjs";
import { miles } from "../../core/geo.mjs";
import { placeFreshness } from "../graph.mjs";
import { STATES, STATE_NAME, cityCounty } from "../stay.mjs";

export { answer };

/** Numbers arrive as strings from some clients: read them as numbers before the bounds apply. */
const num = () => z.coerce.number();

export const OSM_ATTRIBUTION =
  "Hotel names and locations © OpenStreetMap contributors, available under the Open Database License (ODbL).";
export const OFF_LEASH = new Set([
  "off_leash_voice_control",
  "off_leash_allowed",
  "off_leash_part_time",
]);

export const norm = (s) => (s ?? "").toLowerCase();

export const matchesText = (p, query) => {
  if (!query) return true;
  const hay = norm(
    `${p.name} ${p.city ?? ""} ${p.county ?? ""} ${p.brand ?? ""}`,
  );
  return norm(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => hay.includes(word));
};

/** The list item for a place: static fields from the snapshot, freshness for today. */
export function summary(p, today, extra = {}) {
  return {
    id: p.id,
    uid: p.uid,
    name: p.name,
    type: p.type,
    city: p.city,
    county: p.county,
    state: p.state,
    region: p.region,
    area: p.area ?? null,
    area_id: p.area_id ?? null,
    status: p.status,
    answer: p.answer,
    citation: p.citation,
    brand_policy: p.brand_policy,
    confidence: p.confidence,
    confirmed_by: p.confirmed_by,
    freshness: placeFreshness(p, today).state,
    tags: p.tags,
    verified_at: p.verified_at,
    review_due: p.review_due,
    url: p.url,
    markdown_url: p.markdown_url,
    source_urls: p.source_urls,
    record_license: p.record_license,
    ...(p.osm ? { osm: true } : {}),
    ...extra,
  };
}

/** Each list item starts with its citation sentence, then the details behind it. */
export function summaryLine(s) {
  const where = [...cityCounty(s.city, s.county), STATE_NAME[s.state]]
    .filter(Boolean)
    .join(", ");
  const parts = [
    `- ${s.citation}`,
    `  ${s.mile != null ? `Mile ${s.mile.toFixed(1)} · ` : ""}\`${s.id}\`${where ? ` · ${where}` : ""}${s.exit ? ` · ${s.exit}` : ""}${s.distance_miles != null ? ` · ${s.distance_miles} mi` : ""} · freshness ${s.freshness}${s.confirmed_by ? ` · confirmed by the ${s.confirmed_by}` : ""}`,
  ];
  if (s.fee) parts.push(`  Pet fee: ${s.fee}`);
  if (s.reasons?.length) parts.push(`  Notes: ${s.reasons.join(" ")}`);
  return parts.join("\n");
}

// ---- Output contracts (looseObject: fields are added, never removed) ----

export const FRESHNESS = z
  .enum(["fresh", "due", "stale", "unreadable"])
  .describe(
    "fresh: inside its review interval; due: past it; stale: past twice it, confirm before you go; unreadable: the last check could not read the source",
  );
export const CONFIDENCE = z
  .enum(["stated", "inferred_from_agency", "inherited_brand", "unstated"])
  .describe(
    "stated: the place's own source says it; inferred_from_agency: an agency-wide rule; inherited_brand: the chain's policy, not confirmed by this hotel",
  );
export const PlaceItem = z.looseObject({
  id: z.string(),
  uid: z.string().describe("Stable id that survives a rename"),
  name: z.string(),
  type: z.string(),
  status: z.enum(["yes", "yes_restricted", "no", "varies", "unknown"]),
  answer: z.string(),
  citation: z
    .string()
    .describe(
      "Copy-ready citation: answer, source, date checked, record URL, license",
    ),
  confidence: CONFIDENCE,
  confirmed_by: z.enum(["business", "agency"]).nullable(),
  freshness: FRESHNESS,
  verified_at: z.string(),
  url: z.string(),
  source_urls: z.array(z.string()),
  record_license: z.string(),
});
export const Envelope = {
  as_of: z.string().describe("Date the data was built (YYYY-MM-DD)"),
  license: z.looseObject({ name: z.string(), url: z.string() }),
  attribution_text: z.string(),
  attribution_url: z.string(),
};
/**
 * What an answer found, on every tool's output. Absent or "ok" is a normal
 * answer. None of the other values is an error: the server worked, and the
 * fields beside them say what to do next.
 */
export const OutcomeFields = {
  outcome: z
    .enum(["ok", "partial", "no_match", "bad_input", "unavailable"])
    .optional()
    .describe(
      "Absent or ok: a normal answer. no_match: nothing in the data matches, see did_you_mean, nearest and next. bad_input: the arguments cannot be used as given, see next. partial: some of the ids were found, see missing. unavailable: a live source could not be read. None of these is an error.",
    ),
  code: z
    .string()
    .optional()
    .describe("With an outcome other than ok: not_found, invalid, unavailable"),
  message: z.string().optional().describe("What happened, in a sentence"),
  did_you_mean: z
    .array(z.looseObject({}))
    .optional()
    .describe(
      "Close matches to what was asked for: towns, places, slugs or brands, best first",
    ),
  nearest: z
    .array(z.looseObject({}))
    .optional()
    .describe(
      "When nothing is inside the radius: the nearest places in the data, with distance_miles",
    ),
  next: z
    .array(z.string())
    .optional()
    .describe("Calls that would answer the question, in words"),
};
export const ListOutput = (key, extra = {}) =>
  z.looseObject({
    ...Envelope,
    ...OutcomeFields,
    total: z.number(),
    count: z.number(),
    offset: z.number(),
    has_more: z.boolean(),
    [key]: z.array(PlaceItem),
    ...extra,
  });
export const RuleItem = z.looseObject({
  id: z.string(),
  placeId: z.string(),
  kind: z.string(),
  label: z.string(),
  text: z.string().nullable(),
  sourceUrl: z.string(),
  confidence: CONFIDENCE,
  verifiedAt: z.string(),
  freshness: FRESHNESS,
});
export const FactItem = z.looseObject({ label: z.string(), value: z.string() });
export const NotStated = z
  .array(z.string())
  .describe("Expected facts the sources do not state; never guess these");

// ---- Input schema fragments ----

export function locationSchema(graph) {
  return {
    state: z
      .enum(STATES)
      .optional()
      .describe(
        '"CA" or "NV". Also tells apart counties with the same name, such as Humboldt.',
      ),
    county: z
      .string()
      .min(2)
      .max(40)
      .optional()
      .describe(
        'County name without "County", in California or Nevada, e.g. "Monterey" or "Washoe"',
      ),
    region: z
      .enum(graph.regionIds)
      .optional()
      .describe(
        "Region id, e.g. central-coast, san-diego or reno-tahoe-nevada",
      ),
    area: z
      .string()
      .min(2)
      .max(60)
      .optional()
      .describe(
        `Area id, the name a traveler gives the trip: ${graph.areaIds.join(", ")}`,
      ),
    near: z
      .strictObject({
        lat: num()
          .min(32)
          .max(42.1)
          .describe("Latitude in California or Nevada"),
        lon: num()
          .min(-124.5)
          .max(-114)
          .describe("Longitude in California or Nevada"),
        radius_miles: num()
          .min(1)
          .max(200)
          .default(25)
          .describe("Search radius in miles"),
      })
      .optional()
      .describe("Limit to places near a point; results are sorted by distance"),
  };
}

export const pageSchema = {
  limit: num()
    .int()
    .min(1)
    .max(50)
    .default(10)
    .describe("Maximum results to return"),
  offset: num()
    .int()
    .min(0)
    .default(0)
    .describe("Results to skip, for pagination"),
  response_format: z
    .enum(["markdown", "json"])
    .default("markdown")
    .describe("'markdown' for readable text, 'json' for structured data"),
};

export const stayCriteriaSchema = {
  dog_weight_lb: num()
    .min(1)
    .max(300)
    .optional()
    .describe("The dog's weight in pounds"),
  dogs: num().int().min(1).max(10).default(1).describe("Number of dogs"),
  nights: num().int().min(1).max(90).default(1).describe("Nights of the stay"),
  max_total_fee: num()
    .min(0)
    .max(10_000)
    .optional()
    .describe("Most the guest will pay in pet fees for the whole stay, USD"),
};

/** Filters by state, county, region and distance; "near" sorts by distance and adds _distance. */
export function filterByLocation(items, { state, county, region, area, near }) {
  let out = items;
  if (state) out = out.filter((p) => p.state === state);
  if (area) out = out.filter((p) => p.area_id === area);
  if (county)
    out = out.filter(
      (p) => norm(p.county) === norm(county.replace(/ county$/i, "")),
    );
  if (region) out = out.filter((p) => p.regionId === region);
  if (near) {
    out = out
      .filter((p) => p.geo)
      .map((p) => ({ p, d: miles(near, p.geo) }))
      .filter(({ d }) => d <= near.radius_miles)
      .sort((a, b) => a.d - b.d || a.p.name.localeCompare(b.p.name))
      .map(({ p, d }) => ({ place: p, distance: Math.round(d * 10) / 10 }));
    return out;
  }
  return out.map((p) => ({ place: p, distance: null }));
}

/** A list response with the shared envelope, footer and character budget; `emptyLines` show when the page is empty. */
export function listResponse(
  ctx,
  { format, total, offset, items, key, header, extra = {}, emptyLines = [] },
) {
  const osm = items.some((s) => s.osm);
  return pageResult({
    format,
    total,
    offset,
    items,
    key,
    header,
    line: summaryLine,
    footer: [
      ...(items.length ? [] : emptyLines),
      ...ctx.citations.footer(items, { osmLine: OSM_ATTRIBUTION }),
    ],
    extra: { ...extra, ...(osm ? { attribution: OSM_ATTRIBUTION } : {}) },
    envelope: ctx.citations.envelope(ctx.graph.as_of),
    limit: LIMITS.resultCharacters,
  });
}

export { result };

/**
 * Resolves "Monterey", "Monterey, CA", "Washoe County NV" or "Las Vegas" to a
 * point from the gazetteer: cities first, then counties; a state suffix
 * narrows it. Returns { name, kind, state, county, lat, lon } or null.
 */
export function resolveTown(graph, text) {
  // hyphens and underscores read as spaces: "central-valley" is "Central Valley"
  const raw = norm(text)
    .replace(/[.,_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw) return null;
  let state = null;
  let name = raw;
  const m = raw.match(/^(.*?)\s+(ca|nv|california|nevada)$/);
  if (m) {
    name = m[1].trim();
    state = m[2].startsWith("ca") ? "CA" : "NV";
  }
  name = name.replace(/\s+county$/, "");
  const towns = graph.towns.filter((t) => !state || t.state === state);
  const exact = (kind) =>
    towns.find((t) => t.kind === kind && norm(t.name) === name);
  const starts = (kind) =>
    towns.find((t) => t.kind === kind && norm(t.name).startsWith(name));
  // Exact names first, areas before cities ("Lake Tahoe" is the trip, not a
  // town), then an area id, then prefixes.
  return (
    exact("area") ??
    exact("city") ??
    exact("county") ??
    towns.find((t) => t.kind === "area" && t.id === name) ??
    region(graph, name, state) ??
    neighborhood(name, state) ??
    starts("area") ??
    starts("city") ??
    starts("county") ??
    typo(towns, name) ??
    null
  );
}

/**
 * A region ("Central Valley", "central-valley", "Central Coast") as a scope of
 * its member places, like an area: its center is the middle of those places.
 */
function region(graph, name, state) {
  const r = (graph.regions ?? []).find(
    (x) => norm(x.name) === name || x.id.replace(/-/g, " ") === name,
  );
  if (!r) return null;
  const members = graph.places.filter((p) => p.regionId === r.id && p.geo);
  if (!members.length) return null;
  if (state && !members.some((p) => p.state === state)) return null;
  const lat = members.reduce((s, p) => s + p.geo.lat, 0) / members.length;
  const lon = members.reduce((s, p) => s + p.geo.lon, 0) / members.length;
  return {
    name: r.name,
    kind: "region",
    id: r.id,
    county: null,
    state: members[0].state,
    lat: Math.round(lat * 1e4) / 1e4,
    lon: Math.round(lon * 1e4) / 1e4,
  };
}

/** A neighborhood of a city we cover, as a search center (NEIGHBORHOODS). */
function neighborhood(name, state) {
  const n = NEIGHBORHOODS.find(
    (x) => norm(x.name) === name && (!state || x.state === state),
  );
  return n ? { ...n, kind: "city" } : null;
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
    const d = editDistance(norm(t.name), name, limit);
    // closest first; at the same distance a city beats a county ("Montery" is the town)
    const better =
      !best ||
      d < best.d ||
      (d === best.d && t.kind === "city" && best.t.kind !== "city");
    if (d <= limit && better) best = { t, d };
  }
  return best ? { ...best.t, corrected_from: name } : null;
}

// ---- No dead ends: what to offer when nothing matches ----

const compact = (s) => norm(s).replace(/[^a-z0-9]+/g, "");
const tokens = (s) =>
  norm(s)
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w.length >= 3);

/**
 * Towns, counties, areas, regions and neighborhoods close to what was asked
 * for: a shared word ("south lake" -> South Lake Tahoe), a prefix, or a
 * spelling a few letters off. Best first, at most `n`.
 */
export function suggestTowns(graph, text, n = 5) {
  const raw = norm(text)
    .replace(/[.,_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const asked = raw
    .replace(/\s+(ca|nv|california|nevada)$/, "")
    .replace(/\s+county$/, "");
  if (!asked) return [];
  const askedTokens = tokens(asked);
  const limit = Math.max(2, Math.floor(asked.length / 4));
  const candidates = [
    ...graph.towns.map((t) => ({
      name: t.name,
      kind: t.kind,
      state: t.state,
      id: t.id,
      county: t.county ?? null,
      places: t.places ?? 0,
    })),
    ...(graph.regions ?? []).map((r) => ({
      name: r.name,
      kind: "region",
      state: null,
      id: r.id,
      county: null,
      places: 0,
    })),
    ...NEIGHBORHOODS.map((x) => ({
      name: x.name,
      kind: "neighborhood",
      state: x.state,
      id: null,
      county: x.county,
      places: 0,
    })),
  ];
  const scored = [];
  for (const c of candidates) {
    const name = norm(c.name);
    let score = null;
    if (name === asked) score = 0;
    else if (name.startsWith(asked) || asked.startsWith(name)) score = 1;
    else if (
      askedTokens.length &&
      tokens(name).some((w) => askedTokens.includes(w))
    )
      score = 2;
    else {
      const d = editDistance(name, asked, limit);
      if (d <= limit) score = 2 + d;
    }
    if (score !== null) scored.push({ c, score });
  }
  scored.sort(
    (a, b) =>
      a.score - b.score ||
      b.c.places - a.c.places ||
      a.c.name.localeCompare(b.c.name),
  );
  const seen = new Set();
  const out = [];
  for (const { c } of scored) {
    const key = `${c.kind}|${c.name}|${c.state}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name: c.name,
      kind: c.kind,
      ...(c.state ? { state: c.state } : {}),
      ...(c.county ? { county: c.county } : {}),
      ...(c.id ? { id: c.id } : {}),
      ...(c.places ? { places: c.places } : {}),
    });
    if (out.length >= n) break;
  }
  return out;
}

/**
 * Places whose name, town or county shares words with what was asked for, or
 * whose id is a few letters off: best first, at most `n`. For a model that
 * passed a name or a misspelled id instead of an id from a search result.
 */
export function suggestPlaces(graph, text, n = 5) {
  const askedTokens = tokens(text);
  const askedCompact = compact(text);
  const scored = [];
  for (const p of graph.places) {
    const hay = tokens(`${p.name} ${p.city ?? ""} ${p.county ?? ""}`);
    const nameTokens = tokens(p.name);
    const hits = askedTokens.filter((w) => hay.includes(w)).length;
    const nameHits = askedTokens.filter((w) => nameTokens.includes(w)).length;
    let score = null;
    if (askedTokens.length && hits === askedTokens.length)
      score = 0 + (nameHits === askedTokens.length ? 0 : 0.5);
    else if (nameHits >= 1 && (askedTokens.length <= 2 || nameHits >= 2))
      score = 2 + (askedTokens.length - nameHits);
    if (askedCompact.length >= 5) {
      const limit = Math.max(2, Math.floor(askedCompact.length / 5));
      const d = Math.min(
        editDistance(compact(p.id), askedCompact, limit),
        editDistance(compact(p.name), askedCompact, limit),
      );
      if (d <= limit) score = Math.min(score ?? Infinity, 1 + d / 10);
    }
    if (score !== null) scored.push({ p, score });
  }
  scored.sort((a, b) => a.score - b.score || a.p.name.localeCompare(b.p.name));
  return scored.slice(0, n).map(({ p, score }) => ({
    id: p.id,
    name: p.name,
    type: p.type,
    city: p.city ?? null,
    county: p.county ?? null,
    state: p.state,
    url: p.url,
    ...(score <= 1.3 ? { close_match: true } : {}),
  }));
}

/** The one place that is clearly what was meant, or null when it is not clear. */
export function closestPlace(graph, text) {
  const [first, second] = suggestPlaces(graph, text, 2);
  return first?.close_match && !second?.close_match
    ? graph.placeById.get(first.id)
    : null;
}

/** The `n` nearest places to a point, with distance, nearest first. */
export function nearestTo(graph, center, n = 5, keep = () => true) {
  const out = [];
  for (const p of graph.places) {
    if (!p.geo || !keep(p)) continue;
    out.push({
      place: p,
      distance: Math.round(miles(center, p.geo) * 10) / 10,
    });
  }
  return out.sort((a, b) => a.distance - b.distance).slice(0, n);
}

/** The `n` towns with places nearest a point, with distance. */
export function nearestTowns(graph, center, n = 3) {
  return graph.towns
    .filter((t) => t.kind === "city" && t.places > 0)
    .map((t) => ({
      name: t.name,
      kind: t.kind,
      state: t.state,
      places: t.places,
      distance_miles: Math.round(miles(center, t) * 10) / 10,
    }))
    .sort((a, b) => a.distance_miles - b.distance_miles)
    .slice(0, n);
}

const townLine = (t) =>
  `- ${t.name}${t.state ? `, ${t.state}` : ""} (${t.kind}${t.places ? `, ${t.places} places` : ""}${t.distance_miles != null ? `, ${t.distance_miles} mi` : ""})${t.id && t.kind !== "city" ? ` · id \`${t.id}\`` : ""}`;
const placeLine = (p) =>
  `- ${p.name} (\`${p.id}\`, ${p.type}${p.city ? `, ${p.city}` : ""}, ${p.state})${p.close_match ? " · close match" : ""}`;

/** The "Did you mean" and "Try next" lines, for any answer that found nothing. */
export function suggestionLines({
  did_you_mean = [],
  nearest = [],
  next = [],
}) {
  const lines = [];
  if (did_you_mean.length) {
    lines.push("", "Did you mean:");
    lines.push(
      ...did_you_mean.map((x) =>
        x.slug
          ? `- ${x.question} (\`${x.slug}\`)`
          : x.id && !x.kind
            ? placeLine(x)
            : townLine(x),
      ),
    );
  }
  if (nearest.length) {
    lines.push("", "Nearest in the data instead:");
    lines.push(...nearest.map(summaryLine));
  }
  if (next.length) {
    lines.push("", "Try next:");
    lines.push(...next.map((s) => `- ${s}`));
  }
  return lines;
}

/**
 * The markdown of an answer that found nothing: what was asked, why there is
 * no match, the close matches, the nearest records, and what to call next.
 */
export function noMatchText(
  ctx,
  {
    title,
    message,
    did_you_mean = [],
    nearest = [],
    next = [],
    extraLines = [],
  },
) {
  return [
    `# ${title}`,
    "",
    message,
    ...suggestionLines({ did_you_mean, nearest, next }),
    ...extraLines,
    "",
    ctx.citations.licenseLine,
  ].join("\n");
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

/**
 * Neighborhoods people search by name that have no places of their own in the
 * data yet, each inside a city we cover: used only as a search center (the
 * radius finds the real places around it). Centers are approximate.
 */
const NEIGHBORHOODS = [
  {
    name: "Van Nuys",
    county: "Los Angeles",
    state: "CA",
    lat: 34.1867,
    lon: -118.4487,
  },
  {
    name: "North Hollywood",
    county: "Los Angeles",
    state: "CA",
    lat: 34.172,
    lon: -118.3789,
  },
  {
    name: "Studio City",
    county: "Los Angeles",
    state: "CA",
    lat: 34.1486,
    lon: -118.3965,
  },
  {
    name: "Sherman Oaks",
    county: "Los Angeles",
    state: "CA",
    lat: 34.1508,
    lon: -118.449,
  },
  {
    name: "Encino",
    county: "Los Angeles",
    state: "CA",
    lat: 34.1592,
    lon: -118.5012,
  },
  {
    name: "Northridge",
    county: "Los Angeles",
    state: "CA",
    lat: 34.2283,
    lon: -118.5368,
  },
  {
    name: "Hollywood",
    county: "Los Angeles",
    state: "CA",
    lat: 34.0928,
    lon: -118.3287,
  },
  {
    name: "Venice",
    county: "Los Angeles",
    state: "CA",
    lat: 33.985,
    lon: -118.4695,
  },
  {
    name: "San Pedro",
    county: "Los Angeles",
    state: "CA",
    lat: 33.7361,
    lon: -118.2923,
  },
  {
    name: "Silver Lake",
    county: "Los Angeles",
    state: "CA",
    lat: 34.0869,
    lon: -118.2702,
  },
];
