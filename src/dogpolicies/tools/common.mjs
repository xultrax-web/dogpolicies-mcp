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
import { closureLine } from "../vendor/closures.mjs";
import { STATES, STATE_NAME, cityCounty } from "../stay.mjs";
import {
  AREA_NAMES,
  FORMAT_SYNONYMS,
  REGION_NAMES,
  STATE_SYNONYMS,
  choice,
  idChoice,
  idText,
  pageSize,
  pointInput,
} from "./tolerant.mjs";
import { seasonNow, todayOf } from "../vendor/season.mjs";
import {
  AIRPORT_RADIUS_MILES,
  editDistance,
  findAirport,
  gazetteer,
  regionCenters,
  resolveName,
} from "./names.mjs";

export { answer, AIRPORT_RADIUS_MILES, editDistance };

/** Numbers arrive as strings from some clients: read them as numbers before the bounds apply. */
export const num = () => z.coerce.number();
/** What the data calls each id, for the lookups that take a name: {id: [name, alias...]}. */
const namesOf = (rows, aliases) =>
  Object.fromEntries(
    rows.map((r) => [r.id, [r.name, ...(aliases[r.id] ?? [])]]),
  );
/** response_format, with the words people use for it. */
export const formatSchema = () =>
  choice(["markdown", "json"], FORMAT_SYNONYMS, [], "markdown");

export const OSM_ATTRIBUTION =
  "Hotel names and locations © OpenStreetMap contributors, available under the Open Database License (ODbL).";
export const OFF_LEASH = new Set([
  "off_leash_voice_control",
  "off_leash_allowed",
  "off_leash_part_time",
]);

export const norm = (s) => (s ?? "").toLowerCase();

// Words of a name or query: lowercase letters and digits, split on everything else, so
// "Carmel-by-the-Sea" reads as carmel by the sea and "Rosie's" as rosie s.
const wordsOf = (s) => norm(s).split(/[^a-z0-9]+/).filter(Boolean);

/**
 * Every word of the query starts a word of the place's name, city, county or brand.
 * Word starts, not substrings: "Reno" must not find Moreno Valley, while "carm" still
 * finds Carmel and "motel 6" finds Motel 6.
 */
export const matchesText = (p, query) => {
  if (!query) return true;
  const hay = wordsOf(
    `${p.name} ${p.city ?? ""} ${p.county ?? ""} ${p.brand ?? ""}`,
  );
  return wordsOf(query).every((word) => hay.some((h) => h.startsWith(word)));
};

/**
 * Seasonal rules on a date (roadmap R-23): the `today` block of a place with
 * seasonal rules, computed per call from the snapshot's facts.seasons and the
 * seasons rule's source, or null for a place without any.
 */
export function todayFor(p, today) {
  if (!p.facts?.seasons) return null;
  const rule = p.rule_records?.find((r) => r.kind === "seasons") ?? {};
  return todayOf(seasonNow(p, today), rule);
}

// The citation with the seasonal sentence where the answer starts, after the
// place's name, as the site writes it (src/lib/provenance.mjs, citation).
function leadCitation(p, lead) {
  const head = `${p.name}${p.city ? ` (${p.city}, ${p.state})` : ""}: `;
  return p.citation.startsWith(head)
    ? `${head}${lead} ${p.citation.slice(head.length)}`
    : `${lead} ${p.citation}`;
}

/**
 * The list item for a place: static fields from the snapshot, freshness for
 * today, and for a place with seasonal rules the `today` block, whose
 * sentence leads answer and citation while a seasonal rule applies or starts
 * within 14 days.
 */
export function summary(p, today, extra = {}) {
  const seasonal = todayFor(p, today);
  const lead = seasonal?.sentence ?? null;
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
    answer: lead ? `${lead} ${p.answer}` : p.answer,
    citation: lead ? leadCitation(p, lead) : p.citation,
    ...(seasonal ? { today: seasonal } : {}),
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
  if (s.closed_now) parts.push(`  ${closureLine(s.closed_now)}`);
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
/**
 * A rest area Caltrans' lane-closure feed reports fully closed right now
 * (I-5 only; absent when it is open, when no closure is published, or when
 * the live feed could not be read). Caltrans' own reason and end time.
 */
export const ClosedNow = z
  .looseObject({
    reason: z.string().describe("Caltrans' own reason, as published"),
    until: z
      .string()
      .nullable()
      .describe("Caltrans' end time (ISO); null when no end is set"),
    source: z.literal("Caltrans"),
    fetched_at: z.string().describe("When the conditions loop read the feed"),
  })
  .describe(
    "Present only when Caltrans reports this rest area fully closed now. Live feed data, not a verified rule: check quickmap.dot.ca.gov",
  );

const SeasonItem = z.looseObject({
  rule: z.string().describe("The seasonal rule in plain words"),
  season: z
    .string()
    .describe('When it runs, in the source\'s dates: "July 1 to May 15"'),
  area: z.string().nullable(),
  access: z.enum(["yes", "yes_restricted", "no"]).nullable(),
  leash: z.string().nullable(),
});
const Dated = SeasonItem.extend({
  starts: z.string().describe("First day of this run (YYYY-MM-DD)"),
  ends: z.string().describe("Last day of this run (YYYY-MM-DD)"),
});
export const TodayBlock = z
  .looseObject({
    date: z
      .string()
      .describe("The date this was computed for: the server's date"),
    in_season: z
      .boolean()
      .nullable()
      .describe(
        "true: a seasonal rule is in effect on that date; null: the source gives a season without dates",
      ),
    sentence: z
      .string()
      .nullable()
      .describe(
        "Leads answer and citation while a seasonal rule applies or starts within 14 days; null otherwise",
      ),
    in_effect: z.array(Dated.extend({ days_left: z.number() })),
    starts_soon: z.array(Dated.extend({ in_days: z.number() })),
    next: Dated.extend({ in_days: z.number() }).nullable(),
    undated: z
      .array(SeasonItem)
      .describe("Seasons the source states without dates: not known to apply"),
    source_url: z.string().nullable(),
    publisher: z.string().nullable(),
    quote: z.string().nullable(),
    verified_at: z.string().nullable(),
  })
  .describe(
    "Only for a place with seasonal dog rules (plover nesting season, summer beach hours): which applies on the server's date, until when, and which starts next, with the source. Repeat sentence with the answer.",
  );
export const PlaceItem = z.looseObject({
  id: z.string(),
  uid: z.string().describe("Stable id that survives a rename"),
  name: z.string(),
  type: z.string(),
  status: z.enum(["yes", "yes_restricted", "no", "varies", "unknown"]),
  answer: z
    .string()
    .describe(
      "The one-line answer; while a seasonal rule applies today it leads with it (see today)",
    ),
  today: TodayBlock.optional(),
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
  closed_now: ClosedNow.optional(),
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
  accepted: z
    .record(z.string(), z.array(z.string()))
    .optional()
    .describe(
      "With bad_input: each argument that could not be read, with the values it accepts",
    ),
  resolved_from: z
    .record(
      z.string(),
      z.looseObject({
        asked: z.union([z.string(), z.array(z.string())]),
        used: z.union([z.string(), z.array(z.string())]),
      }),
    )
    .optional()
    .describe(
      "Set when a word was read as the value the tool uses: hotel as lodging, NB as north. Each key is the argument; asked is what was sent, used what it was read as",
    ),
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
  .describe("Expected facts the sources do not state");

// ---- Input schema fragments ----

export function locationSchema(graph) {
  return {
    state: choice(STATES, STATE_SYNONYMS)
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
    region: idChoice(graph.regionIds, namesOf(graph.regions, REGION_NAMES))
      .optional()
      .describe(
        "Region id, e.g. central-coast, san-diego or reno-tahoe-nevada",
      ),
    area: idText(
      graph.areaIds,
      namesOf(graph.areas, AREA_NAMES),
      z.string().min(2).max(60),
    )
      .optional()
      .describe(
        `Area id, the name a traveler gives the trip: ${graph.areaIds.join(", ")}`,
      ),
    near: z
      .preprocess(
        pointInput,
        z.strictObject({
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
        }),
      )
      .optional()
      .describe("Limit to places near a point; results are sorted by distance"),
  };
}

export const pageSchema = {
  limit: pageSize({ max: 50, fallback: 10 }).describe(
    "Maximum results to return",
  ),
  offset: num()
    .int()
    .min(0)
    .default(0)
    .describe("Results to skip, for pagination"),
  response_format: formatSchema().describe(
    "'markdown' for readable text, 'json' for structured data",
  ),
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
 * Resolves "Monterey", "Monterey, CA", "Washoe County NV", "Las Vegas",
 * "Koreatown", "SFO" or "Montery" to a point from the gazetteer: the reading
 * lives in names.mjs (the website runs the same file in the browser). Returns
 * { name, kind, state, county, lat, lon } or null.
 */
export function resolveTown(graph, text, options = {}) {
  return resolveName(gazetteerOf(graph), text, options);
}

// The gazetteer of a snapshot, built once (keyed by its towns array): the
// towns, each region's center, and the airport and neighborhood tables below.
const gazetteers = new WeakMap();
function gazetteerOf(graph) {
  let entry = gazetteers.get(graph.towns);
  if (
    !entry ||
    entry.places !== graph.places ||
    entry.regions !== graph.regions
  ) {
    entry = {
      places: graph.places,
      regions: graph.regions,
      gaz: gazetteer({
        towns: graph.towns,
        regions: regionCenters(graph.regions ?? [], graph.places ?? []),
        airports: AIRPORTS,
        neighborhoods: NEIGHBORHOODS,
      }),
    };
    gazetteers.set(graph.towns, entry);
  }
  return entry.gaz;
}

let airportsOnly = null;
/**
 * The airport a free-text query names exactly ("LAX", "LAX airport", "Harry
 * Reid"), as a { lat, lon, radius_miles } point, or null. find_hotels uses it
 * so "hotels near LAX" works through its `query` words.
 */
export function airportPoint(text) {
  const a = findAirport(
    (airportsOnly ??= gazetteer({ airports: AIRPORTS })),
    text,
  );
  return a
    ? {
        lat: a.lat,
        lon: a.lon,
        radius_miles: a.radius_miles,
        name: a.name,
        code: a.code,
      }
    : null;
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
    ...AIRPORTS.flatMap((a) => [
      {
        name: a.name,
        kind: "airport",
        state: a.state,
        id: null,
        county: a.county,
        places: 0,
      },
      {
        name: a.code,
        kind: "airport",
        state: a.state,
        id: null,
        county: a.county,
        places: 0,
      },
    ]),
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

/**
 * The commercial airports people fly out of with a dog, as search centers
 * (roadmap R-20). Each center is the middle of the airport's aerodrome area in
 * OpenStreetMap (aeroway=aerodrome with the IATA code, read through the
 * Overpass API on 2026-11-09, (c) OpenStreetMap contributors, ODbL). It locates
 * the airport for scope resolution only; it never makes a rule. The default
 * radius is AIRPORT_RADIUS_MILES, so "hotels near LAX" means the ones around
 * the terminals. `aliases` are the other names people say.
 */
export const AIRPORTS = [
  {
    code: "SFO",
    name: "San Francisco International Airport",
    county: "San Mateo",
    state: "CA",
    lat: 37.6218,
    lon: -122.379,
    aliases: ["san francisco international", "san francisco airport"],
  },
  {
    code: "OAK",
    name: "Oakland International Airport",
    county: "Alameda",
    state: "CA",
    lat: 37.7223,
    lon: -122.2253,
    aliases: [
      "oakland airport",
      "oakland san francisco bay airport",
      "metro oakland",
    ],
  },
  {
    code: "SJC",
    name: "San Jose Mineta International Airport",
    county: "Santa Clara",
    state: "CA",
    lat: 37.3632,
    lon: -121.9281,
    aliases: [
      "san jose airport",
      "san jose international",
      "mineta san jose",
      "san jose mineta",
      "norman y mineta san jose international",
    ],
  },
  {
    code: "SMF",
    name: "Sacramento International Airport",
    county: "Sacramento",
    state: "CA",
    lat: 38.693,
    lon: -121.5931,
    aliases: ["sacramento airport"],
  },
  {
    code: "LAX",
    name: "Los Angeles International Airport",
    county: "Los Angeles",
    state: "CA",
    lat: 33.9422,
    lon: -118.4088,
    aliases: ["los angeles international", "los angeles airport", "la airport"],
  },
  {
    code: "BUR",
    name: "Hollywood Burbank Airport",
    county: "Los Angeles",
    state: "CA",
    lat: 34.2036,
    lon: -118.3596,
    aliases: ["burbank airport", "bob hope airport", "burbank bob hope"],
  },
  {
    code: "LGB",
    name: "Long Beach Airport",
    county: "Los Angeles",
    state: "CA",
    lat: 33.8156,
    lon: -118.151,
    aliases: ["long beach daugherty field"],
  },
  {
    code: "SNA",
    name: "John Wayne Airport",
    county: "Orange",
    state: "CA",
    lat: 33.6743,
    lon: -117.8677,
    aliases: [
      "orange county airport",
      "john wayne orange county",
      "santa ana airport",
    ],
  },
  {
    code: "ONT",
    name: "Ontario International Airport",
    county: "San Bernardino",
    state: "CA",
    lat: 34.0556,
    lon: -117.6022,
    aliases: ["ontario airport", "ontario california airport"],
  },
  {
    code: "SAN",
    name: "San Diego International Airport",
    county: "San Diego",
    state: "CA",
    lat: 32.7339,
    lon: -117.1914,
    aliases: [
      "san diego airport",
      "san diego international",
      "lindbergh field",
    ],
  },
  {
    code: "PSP",
    name: "Palm Springs International Airport",
    county: "Riverside",
    state: "CA",
    lat: 33.8304,
    lon: -116.5085,
    aliases: ["palm springs airport", "palm springs international"],
  },
  {
    code: "FAT",
    name: "Fresno Yosemite International Airport",
    county: "Fresno",
    state: "CA",
    lat: 36.7759,
    lon: -119.7183,
    aliases: [
      "fresno airport",
      "fresno yosemite",
      "fresno yosemite international",
    ],
  },
  {
    code: "SBA",
    name: "Santa Barbara Airport",
    county: "Santa Barbara",
    state: "CA",
    lat: 34.427,
    lon: -119.8423,
    aliases: [
      "santa barbara municipal airport",
      "santa barbara municipal",
      "santa barbara airport",
    ],
  },
  {
    code: "SBP",
    name: "San Luis Obispo County Regional Airport",
    county: "San Luis Obispo",
    state: "CA",
    lat: 35.2375,
    lon: -120.6415,
    aliases: [
      "san luis obispo airport",
      "slo airport",
      "san luis obispo regional",
      "san luis obispo regional airport",
      "sloairport",
    ],
  },
  {
    code: "MRY",
    name: "Monterey Regional Airport",
    county: "Monterey",
    state: "CA",
    lat: 36.5871,
    lon: -121.8462,
    aliases: [
      "monterey airport",
      "monterey peninsula airport",
      "monterey regional",
    ],
  },
  {
    code: "STS",
    name: "Charles M. Schulz Sonoma County Airport",
    county: "Sonoma",
    state: "CA",
    lat: 38.5105,
    lon: -122.8132,
    aliases: [
      "sonoma county airport",
      "santa rosa airport",
      "schulz sonoma county",
      "charles schulz sonoma county airport",
    ],
  },
  {
    code: "RNO",
    name: "Reno-Tahoe International Airport",
    county: "Washoe",
    state: "NV",
    lat: 39.4981,
    lon: -119.7684,
    aliases: [
      "reno airport",
      "reno tahoe",
      "reno tahoe airport",
      "reno tahoe international",
      "reno international airport",
    ],
  },
  {
    code: "LAS",
    name: "Harry Reid International Airport",
    county: "Clark",
    state: "NV",
    lat: 36.0861,
    lon: -115.1459,
    aliases: [
      "harry reid",
      "mccarran",
      "mccarran airport",
      "mccarran international",
      "mccarran international airport",
      "las vegas airport",
      "las vegas international airport",
      "vegas airport",
    ],
  },
];

/**
 * Neighborhoods people search by name that have no places of their own in the
 * data yet, each inside a city we cover: used only as a search center (the
 * radius finds the real places around it). Centers are approximate. `aliases`
 * are the other names people say ("Venice Beach", "DTLA", "the Mission");
 * 0.4.1 added the second ring (roadmap R-01) from the misses log.
 */
export const NEIGHBORHOODS = [
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
    aliases: ["venice beach"],
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
  {
    name: "Koreatown",
    county: "Los Angeles",
    state: "CA",
    lat: 34.0577,
    lon: -118.3009,
    aliases: ["k-town", "ktown"],
  },
  {
    name: "Downtown Los Angeles",
    county: "Los Angeles",
    state: "CA",
    lat: 34.0407,
    lon: -118.2468,
    aliases: ["dtla", "downtown la"],
  },
  {
    name: "Echo Park",
    county: "Los Angeles",
    state: "CA",
    lat: 34.0782,
    lon: -118.2606,
  },
  {
    name: "Los Feliz",
    county: "Los Angeles",
    state: "CA",
    lat: 34.1064,
    lon: -118.2886,
  },
  {
    name: "Highland Park",
    county: "Los Angeles",
    state: "CA",
    lat: 34.1115,
    lon: -118.1926,
  },
  {
    name: "Eagle Rock",
    county: "Los Angeles",
    state: "CA",
    lat: 34.1394,
    lon: -118.2111,
  },
  {
    name: "Westwood",
    county: "Los Angeles",
    state: "CA",
    lat: 34.0633,
    lon: -118.4456,
  },
  {
    name: "Brentwood",
    county: "Los Angeles",
    state: "CA",
    lat: 34.052,
    lon: -118.4732,
  },
  {
    name: "Pacific Palisades",
    county: "Los Angeles",
    state: "CA",
    lat: 34.048,
    lon: -118.526,
  },
  {
    name: "Playa del Rey",
    county: "Los Angeles",
    state: "CA",
    lat: 33.955,
    lon: -118.442,
  },
  {
    name: "Mar Vista",
    county: "Los Angeles",
    state: "CA",
    lat: 34.003,
    lon: -118.432,
  },
  {
    name: "Boyle Heights",
    county: "Los Angeles",
    state: "CA",
    lat: 34.0339,
    lon: -118.2046,
  },
  {
    name: "Woodland Hills",
    county: "Los Angeles",
    state: "CA",
    lat: 34.1684,
    lon: -118.6059,
  },
  {
    name: "Tarzana",
    county: "Los Angeles",
    state: "CA",
    lat: 34.1734,
    lon: -118.5537,
  },
  {
    name: "Reseda",
    county: "Los Angeles",
    state: "CA",
    lat: 34.2011,
    lon: -118.5363,
  },
  {
    name: "Canoga Park",
    county: "Los Angeles",
    state: "CA",
    lat: 34.2011,
    lon: -118.5979,
  },
  {
    name: "Chatsworth",
    county: "Los Angeles",
    state: "CA",
    lat: 34.2572,
    lon: -118.6013,
  },
  {
    name: "Granada Hills",
    county: "Los Angeles",
    state: "CA",
    lat: 34.265,
    lon: -118.5225,
  },
  {
    name: "Belmont Shore",
    county: "Los Angeles",
    state: "CA",
    lat: 33.759,
    lon: -118.137,
  },
  {
    name: "Mission District",
    county: "San Francisco",
    state: "CA",
    lat: 37.7599,
    lon: -122.4148,
    aliases: ["the mission", "mission"],
  },
  {
    name: "Castro",
    county: "San Francisco",
    state: "CA",
    lat: 37.7609,
    lon: -122.435,
    aliases: ["the castro"],
  },
  {
    name: "Noe Valley",
    county: "San Francisco",
    state: "CA",
    lat: 37.7502,
    lon: -122.4337,
  },
  {
    name: "Marina District",
    county: "San Francisco",
    state: "CA",
    lat: 37.803,
    lon: -122.436,
    aliases: ["the marina"],
  },
  {
    name: "Richmond District",
    county: "San Francisco",
    state: "CA",
    lat: 37.78,
    lon: -122.483,
    aliases: ["inner richmond", "outer richmond"],
  },
  {
    name: "Sunset District",
    county: "San Francisco",
    state: "CA",
    lat: 37.753,
    lon: -122.49,
    aliases: ["the sunset", "inner sunset", "outer sunset"],
  },
  {
    name: "Haight-Ashbury",
    county: "San Francisco",
    state: "CA",
    lat: 37.7692,
    lon: -122.4481,
    aliases: ["the haight", "haight"],
  },
  {
    name: "Bernal Heights",
    county: "San Francisco",
    state: "CA",
    lat: 37.741,
    lon: -122.415,
  },
  {
    name: "Potrero Hill",
    county: "San Francisco",
    state: "CA",
    lat: 37.7605,
    lon: -122.4,
  },
  {
    name: "South of Market",
    county: "San Francisco",
    state: "CA",
    lat: 37.7785,
    lon: -122.4056,
    aliases: ["soma"],
  },
  {
    name: "Dogpatch",
    county: "San Francisco",
    state: "CA",
    lat: 37.758,
    lon: -122.389,
  },
  {
    name: "Pacific Heights",
    county: "San Francisco",
    state: "CA",
    lat: 37.7925,
    lon: -122.4382,
  },
  {
    name: "Nob Hill",
    county: "San Francisco",
    state: "CA",
    lat: 37.793,
    lon: -122.4161,
  },
  {
    name: "North Beach",
    county: "San Francisco",
    state: "CA",
    lat: 37.806,
    lon: -122.4103,
  },
  {
    name: "Hayes Valley",
    county: "San Francisco",
    state: "CA",
    lat: 37.7759,
    lon: -122.4245,
  },
  {
    name: "Rockridge",
    county: "Alameda",
    state: "CA",
    lat: 37.844,
    lon: -122.252,
  },
  {
    name: "Temescal",
    county: "Alameda",
    state: "CA",
    lat: 37.834,
    lon: -122.263,
  },
  {
    name: "Midtown Sacramento",
    county: "Sacramento",
    state: "CA",
    lat: 38.572,
    lon: -121.471,
    aliases: ["midtown"],
  },
  {
    name: "Willow Glen",
    county: "Santa Clara",
    state: "CA",
    lat: 37.308,
    lon: -121.89,
  },
  {
    name: "La Jolla",
    county: "San Diego",
    state: "CA",
    lat: 32.8328,
    lon: -117.2713,
  },
  {
    name: "Pacific Beach",
    county: "San Diego",
    state: "CA",
    lat: 32.7978,
    lon: -117.2403,
  },
  {
    name: "Mission Beach",
    county: "San Diego",
    state: "CA",
    lat: 32.77,
    lon: -117.252,
  },
  {
    name: "Hillcrest",
    county: "San Diego",
    state: "CA",
    lat: 32.748,
    lon: -117.163,
  },
  {
    name: "North Park",
    county: "San Diego",
    state: "CA",
    lat: 32.741,
    lon: -117.129,
  },
  {
    name: "Point Loma",
    county: "San Diego",
    state: "CA",
    lat: 32.74,
    lon: -117.24,
  },
  {
    name: "Gaslamp Quarter",
    county: "San Diego",
    state: "CA",
    lat: 32.7114,
    lon: -117.16,
    aliases: ["gaslamp", "downtown san diego"],
  },
  {
    name: "The Strip",
    county: "Clark",
    state: "NV",
    lat: 36.1147,
    lon: -115.1728,
    aliases: ["las vegas strip", "vegas strip"],
  },
  {
    name: "Summerlin",
    county: "Clark",
    state: "NV",
    lat: 36.186,
    lon: -115.321,
  },
  {
    name: "Downtown Las Vegas",
    county: "Clark",
    state: "NV",
    lat: 36.1699,
    lon: -115.1398,
    aliases: ["fremont street"],
  },
];
