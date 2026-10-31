// Shared pieces of the DogPolicies tools: the place summary every list
// returns, the markdown line for it, the input schema fragments, location
// filtering and the list responder. A tool file imports from here and from
// the core; it never reaches into the snapshot format on its own.

import * as z from "zod/v4";
import { LIMITS } from "../../config.mjs";
import { pageResult, result } from "../../core/result.mjs";
import { miles } from "../../core/geo.mjs";
import { placeFreshness } from "../graph.mjs";
import { STATES, STATE_NAME, cityCounty } from "../stay.mjs";

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
export const ListOutput = (key, extra = {}) =>
  z.looseObject({
    ...Envelope,
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
        "Area id inside a region (a tourist area such as a valley, coast or metro), when the data has areas",
      ),
    near: z
      .strictObject({
        lat: z
          .number()
          .min(32)
          .max(42.1)
          .describe("Latitude in California or Nevada"),
        lon: z
          .number()
          .min(-124.5)
          .max(-114)
          .describe("Longitude in California or Nevada"),
        radius_miles: z
          .number()
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
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(10)
    .describe("Maximum results to return"),
  offset: z
    .number()
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
  dog_weight_lb: z
    .number()
    .min(1)
    .max(250)
    .optional()
    .describe("The dog's weight in pounds"),
  dogs: z.number().int().min(1).max(4).default(1).describe("Number of dogs"),
  nights: z
    .number()
    .int()
    .min(1)
    .max(30)
    .default(1)
    .describe("Nights of the stay"),
  max_total_fee: z
    .number()
    .min(0)
    .max(5000)
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

/** A list response with the shared envelope, footer and character budget. */
export function listResponse(
  ctx,
  { format, total, offset, items, key, header, extra = {} },
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
    footer: ctx.citations.footer(items, { osmLine: OSM_ATTRIBUTION }),
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
  const raw = norm(text).replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
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
  return (
    exact("city") ??
    exact("county") ??
    starts("city") ??
    starts("county") ??
    null
  );
}
