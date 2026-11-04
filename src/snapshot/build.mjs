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

function placeRecord(
  p,
  { regionName, areaName, tagsOf, abs, placePath, ruleJson },
) {
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
    // Areas (Region > Area > City > Place) land on the `areas` branch; the
    // fields are optional here so the snapshot format needs no bump.
    area_id: p.areaId ?? null,
    area: p.areaId ? (areaName[p.areaId] ?? null) : null,
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
    // The I-5 axis position (s, offM, side, ele, strip, mile), or absent.
    axis: p.axis ?? undefined,
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

/** The centroid of the places in an area, or null when none has coordinates. */
function centroid(places) {
  const geo = places.filter((p) => p.geo);
  if (!geo.length) return null;
  const lat = geo.reduce((s, p) => s + p.geo.lat, 0) / geo.length;
  const lon = geo.reduce((s, p) => s + p.geo.lon, 0) / geo.length;
  return { lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4 };
}

/** An area as the snapshot carries it: the name a traveler gives the trip. */
function areaRecord(a, places) {
  const members = places.filter((p) => p.areaId === a.id);
  return {
    id: a.id,
    name: a.name,
    in_name: a.inName ?? a.name,
    kind: a.kind ?? null,
    regionId: a.regionId ?? null,
    state: a.state ?? "CA",
    blurb: a.blurb ?? null,
    places: members.length,
    centroid: centroid(members),
  };
}

/** The gazetteer entry for an area, so "Lake Tahoe" resolves like a town. */
function areaTown(a, places) {
  const members = places.filter((p) => p.areaId === a.id);
  const c = centroid(members);
  if (!c) return null;
  return {
    name: a.name,
    kind: "area",
    id: a.id,
    county: null,
    state: a.state ?? "CA",
    lat: c.lat,
    lon: c.lon,
    places: members.length,
  };
}

/**
 * A gazetteer built from the places themselves: every city and county that
 * has places with coordinates, with the centroid of those places. It lets a
 * tool take "Monterey" or "Washoe County, NV" instead of a latitude.
 */
export function towns(places) {
  const acc = new Map();
  const add = (key, entry, p) => {
    const t = acc.get(key) ?? { ...entry, lat: 0, lon: 0, places: 0 };
    t.lat += p.geo.lat;
    t.lon += p.geo.lon;
    t.places++;
    acc.set(key, t);
  };
  for (const p of places) {
    if (!p.geo) continue;
    if (p.city)
      add(
        `city:${p.city}|${p.state}`,
        {
          name: p.city,
          kind: "city",
          county: p.county ?? null,
          state: p.state,
        },
        p,
      );
    if (p.county)
      add(
        `county:${p.county}|${p.state}`,
        { name: p.county, kind: "county", county: p.county, state: p.state },
        p,
      );
  }
  return [...acc.values()]
    .map((t) => ({
      ...t,
      lat: Math.round((t.lat / t.places) * 1e4) / 1e4,
      lon: Math.round((t.lon / t.places) * 1e4) / 1e4,
    }))
    .sort((a, b) => b.places - a.places || a.name.localeCompare(b.name));
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
 * @param {object} [deps.axes] per route id, the axis block (src/lib/axis-snapshot.mjs)
 */
export function buildSnapshot(graph, deps) {
  const { site, answers, routeGuides, axes = {} } = deps;
  const regionName = Object.fromEntries(
    graph.regions.map((r) => [r.id, r.name]),
  );
  const areaName = Object.fromEntries(
    (graph.areas ?? []).map((a) => [a.id, a.name]),
  );
  const ctx = { ...deps, regionName, areaName };
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
    areas: (graph.areas ?? []).map((a) => areaRecord(a, graph.places)),
    towns: [
      ...(graph.areas ?? [])
        .map((a) => areaTown(a, graph.places))
        .filter(Boolean),
      ...towns(graph.places),
    ],
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
          // The I-5 axis: calibration table, strips, paired stops (0.3.0).
          ...(axes[id] ? { axis: axes[id] } : {}),
          stops: (graph.corridors[id] ?? []).map((s) =>
            clean({
              place_id: s.place.id,
              mile: s.mile,
              off_miles: s.offMiles,
              via: s.via,
              side: s.side,
              // The I-5 axis: s in meters, side of northbound travel,
              // elevation, strip (src/lib/axis.mjs).
              s_m: s.axis?.s,
              off_m: s.axis?.offM,
              axis_side: s.axis?.side,
              elevation_m: s.axis?.ele,
              strip: s.axis?.strip,
            }),
          ),
        },
      ]),
    ),
    changes: graph.changes.entries,
  };
}
