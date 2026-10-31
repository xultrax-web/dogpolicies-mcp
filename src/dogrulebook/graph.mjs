// Validates a snapshot and turns it into the in-memory graph the tools read:
// indexes by id, a rule index, and date-aware views (freshness per rule and
// per place, computed for today, never stored).

import * as z from "zod/v4";
import { SNAPSHOT_SCHEMA } from "../snapshot/build.mjs";
import { freshnessOf, worstFreshness } from "../core/freshness.mjs";

const Rule = z.looseObject({
  id: z.string(),
  kind: z.string(),
  verifiedAt: z.string(),
  reviewDue: z.string(),
});
const Place = z.looseObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  uid: z.string(),
  name: z.string(),
  type: z.string(),
  state: z.string(),
  status: z.string(),
  answer: z.string(),
  citation: z.string(),
  verified_at: z.string(),
  review_due: z.string(),
  url: z.string(),
  rule_records: z.array(Rule),
  facts: z.record(z.string(), z.looseObject({})),
});
const Snapshot = z.looseObject({
  schema: z.literal(SNAPSHOT_SCHEMA),
  as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  site: z.looseObject({
    name: z.string(),
    url: z.string().url(),
    license: z.looseObject({ name: z.string(), url: z.string() }),
  }),
  regions: z.array(z.looseObject({ id: z.string(), name: z.string() })),
  places: z.array(Place).min(1),
  brands: z.array(z.looseObject({ id: z.string(), name: z.string() })),
  answers: z.array(
    z.looseObject({
      slug: z.string(),
      question: z.string(),
      place_ids: z.array(z.string()),
    }),
  ),
  routes: z.record(
    z.string(),
    z.looseObject({
      id: z.string(),
      short: z.string(),
      state: z.string(),
      length_miles: z.number(),
      heading: z.enum(["north", "east"]),
      points: z.array(z.array(z.any())),
      stops: z.array(z.looseObject({ place_id: z.string(), mile: z.number() })),
    }),
  ),
  changes: z.array(z.looseObject({ date: z.string() })),
});

/** Throws with a readable message when a snapshot is not one we can serve. */
export function validateSnapshot(raw) {
  const parsed = Snapshot.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(
      `snapshot rejected: ${first.path.join(".")}: ${first.message}`,
    );
  }
  return parsed.data;
}

export const snapshotVersion = (s) => s.as_of;

/** Builds the indexes once per snapshot. Date-aware fields are computed per call. */
export function hydrate(snapshot) {
  const placeById = new Map(snapshot.places.map((p) => [p.id, p]));
  const ruleIndex = new Map();
  for (const p of snapshot.places)
    for (const r of p.rule_records) ruleIndex.set(r.id, { place: p, rule: r });
  const brandById = new Map(snapshot.brands.map((b) => [b.id, b]));
  const answerBySlug = new Map(snapshot.answers.map((a) => [a.slug, a]));
  const routes = Object.fromEntries(
    Object.entries(snapshot.routes).map(([id, r]) => [
      id,
      {
        ...r,
        stops: r.stops
          .map((s) => ({ ...s, place: placeById.get(s.place_id) }))
          .filter((s) => s.place),
      },
    ]),
  );
  const events = snapshot.places
    .flatMap((p) =>
      (p.verifications ?? []).map((v) => ({
        ...v,
        placeId: p.id,
        placeUid: p.uid,
        name: p.name,
        url: p.url,
      })),
    )
    .sort((a, b) => b.at.localeCompare(a.at) || a.name.localeCompare(b.name));
  return {
    ...snapshot,
    placeById,
    ruleIndex,
    brandById,
    answerBySlug,
    routes,
    events,
    regionIds: snapshot.regions.map((r) => r.id),
    brandIds: snapshot.brands.map((b) => b.id),
    routeIds: Object.keys(routes),
  };
}

/** Freshness of every rule and the place as a whole, for a date. */
export function placeFreshness(place, today) {
  const byKind = {};
  for (const r of place.rule_records) byKind[r.kind] = freshnessOf(r, today);
  return { byKind, state: worstFreshness(Object.values(byKind)) };
}

/** The rule with freshness filled in for today. */
export const ruleWithFreshness = (r, today) => ({
  ...r,
  freshness: freshnessOf(r, today),
});
