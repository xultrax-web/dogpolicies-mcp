// Turns the site's data graph into the snapshot the package ships: every
// field a tool needs, precomputed, with nothing that depends on the date
// (freshness is recomputed at call time from verifiedAt and reviewDue).
//
// This module runs inside the repository (it takes the loaded graph as its
// input) and is also used by the site's /data/mcp-snapshot-v1.json endpoint,
// so the hosted snapshot and the bundled one are built by the same code.

/** Snapshot format version. Bump when a field changes meaning or disappears. */
export const SNAPSHOT_SCHEMA = 1;

const clean = (obj) =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

function placeRecord(p, { regionName, tagsOf, abs, placePath, ruleJson }) {
  const sourceKeys = Object.keys(p.sources);
  return clean({
    id: p.id,
    uid: p.uid,
    name: p.name,
    type: p.type,
    city: p.city ?? null,
    county: p.county ?? null,
    state: p.state,
    regionId: p.regionId ?? null,
    region: p.regionId ? (regionName[p.regionId] ?? null) : null,
    status: p.answer.status,
    answer: p.answer.headline,
    citation: p.citation,
    brand_policy: Boolean(p.facts.dogsAllowed?.inheritedFrom),
    confidence:
      p.rules.find((r) => r.kind === "dogsAllowed")?.confidence ?? "unstated",
    confirmed_by: p.confirmedBy ?? null,
    tags: tagsOf(p),
    verified_at: p.verifiedAt,
    review_due: p.freshness.reviewDue,
    url: abs(placePath(p)),
    markdown_url: abs(`/places/${p.id}.md`),
    source_urls: [
      ...new Set(Object.values(p.facts).map((f) => p.sources[f.source].url)),
    ],
    record_license: p.license,
    osm: p.provenance === "import:osm-chain-hotels" || undefined,
    geo: p.geo ?? null,
    managing_agency: p.managingAgency ?? null,
    brand: p.brandName ?? null,
    brand_id: p.brandId ?? null,
    address: [p.address, p.city, p.zip].filter(Boolean).join(", ") || null,
    exit: p.exit ?? null,
    // The typed facts the matcher reads: fee, weight limit, pet count, leash, inheritance.
    facts: Object.fromEntries(
      Object.entries(p.facts).map(([k, f]) => [
        k,
        clean({
          value: f.value,
          byApproval: f.byApproval || undefined,
          combined: f.combined || undefined,
          inheritedFrom: f.inheritedFrom || undefined,
        }),
      ]),
    ),
    rows: p.rows.map((r) =>
      clean({
        key: r.key,
        label: r.label,
        value: r.display,
        note: r.note ?? null,
        source: sourceKeys.indexOf(r.source) + 1,
        from_brand_policy: Boolean(r.inheritedFrom),
      }),
    ),
    not_stated: p.unstated.map((r) => r.label),
    rules: p.facts.rules?.value ?? [],
    rule_records: p.rules.map((r) => {
      const j = ruleJson(r);
      // freshness is date-dependent; keep only what recomputes it
      const { freshness, ...rest } = j;
      return clean({
        ...rest,
        unreadable: freshness === "unreadable" || undefined,
      });
    }),
    sources: Object.values(p.sources).map((s, i) =>
      clean({
        n: i + 1,
        publisher: s.publisher,
        title: s.title,
        url: s.url,
        kind: s.kind,
        checked: s.capturedAt,
        quote: s.quote ?? null,
      }),
    ),
    // Every field of an event, as the API publishes it (at, outcome, by, method, facts, note).
    verifications: (p.verifications ?? []).map((v) => clean({ ...v })),
  });
}

function brandRecord(b, { abs, brandPath }) {
  return {
    id: b.id,
    name: b.name,
    answer: b.answer.headline,
    applies_to: b.scope ?? null,
    facts: b.rows.map((r) =>
      clean({ label: r.label, value: r.display, note: r.note ?? null }),
    ),
    not_stated: b.unstated.map((r) => r.label),
    rules: b.facts.rules?.value ?? [],
    exceptions: b.exceptions.map((x) => ({
      name: x.name,
      state: x.state,
      note: x.note,
    })),
    california_properties: b.properties.filter((p) => p.state === "CA").length,
    nevada_properties: b.properties.filter((p) => p.state === "NV").length,
    source: Object.values(b.sources)[0]?.url ?? null,
    source_urls: [
      ...new Set(
        Object.values(b.facts)
          .map((f) => b.sources[f.source]?.url)
          .filter(Boolean),
      ),
    ],
    verified_at: b.verifiedAt,
    url: abs(brandPath(b)),
  };
}

/**
 * @param {object} graph the loaded graph (loadGraph())
 * @param {object} deps helpers from the repository
 * @param {object} deps.site
 * @param {Function} deps.tagsOf
 * @param {Function} deps.abs
 * @param {Function} deps.placePath
 * @param {Function} deps.brandPath
 * @param {Function} deps.ruleJson
 * @param {Array} deps.answers from getAnswers(graph)
 * @param {object} deps.routeGuides ROUTE_GUIDES
 */
export function buildSnapshot(graph, deps) {
  const { site, answers, routeGuides } = deps;
  const regionName = Object.fromEntries(
    graph.regions.map((r) => [r.id, r.name]),
  );
  const ctx = { ...deps, regionName };
  return {
    schema: SNAPSHOT_SCHEMA,
    as_of: graph.builtAt,
    site: {
      name: site.name,
      url: site.url,
      license: site.license,
      coverage: site.coverage,
      tagline: site.tagline,
    },
    regions: graph.regions.map((r) => ({ id: r.id, name: r.name })),
    places: graph.places.map((p) => placeRecord(p, ctx)),
    brands: graph.brands.map((b) => brandRecord(b, ctx)),
    answers: answers.map((a) => ({
      slug: a.slug,
      question: a.question,
      intro: a.intro ?? "",
      place_ids: a.items.map((p) => p.id),
    })),
    routes: Object.fromEntries(
      Object.entries(graph.routes).map(([id, r]) => [
        id,
        {
          id,
          short: r.short,
          state: r.state,
          length_miles: r.lengthMiles,
          heading: routeGuides[id]?.heading === "east" ? "east" : "north",
          points: r.points,
          stops: (graph.corridors[id] ?? []).map((s) =>
            clean({
              place_id: s.place.id,
              mile: s.mile,
              off_miles: s.offMiles,
              via: s.via,
              side: s.side,
            }),
          ),
        },
      ]),
    ),
    changes: graph.changes.entries,
  };
}
