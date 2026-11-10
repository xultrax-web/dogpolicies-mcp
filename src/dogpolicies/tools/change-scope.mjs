// The scopes the change tools and the change feeds answer for (roadmap R-34):
// a town, county, area, region, neighborhood or point (scope.mjs), one place by
// its id, or the stops dogpolicies_route_stops lists for a highway between two
// miles. Each resolves to the same thing: the places in scope, with how far each
// is, and a label to print. A scope that does not resolve is an answer with
// did_you_mean, never an error (decision 96).

import { isSafeId } from "../../core/safety.mjs";
import { closestPlace, suggestPlaces } from "./common.mjs";
import { routeStops } from "./route-stops.mjs";
import { resolveScope } from "./scope.mjs";

const compact = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

/**
 * "I-5", "i5", "Interstate 5", "US 101", "Hwy 1", "I-80 Nevada" or a route id
 * to a route id, or null. A bare number prefers the California route unless
 * Nevada is named.
 */
export function resolveRoute(graph, text) {
  const ids = graph.routeIds ?? [];
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  if (ids.includes(raw)) return raw;
  const nevada = /\b(nv|nevada)\b/i.test(raw);
  const c = compact(raw)
    .replace(/^interstate/, "i")
    .replace(/^(hwy|highway|sr|ca|state route|route)(?=\d)/, "highway")
    .replace(/(nv|nevada)$/, "");
  const exact = ids.find(
    (id) =>
      compact(id).replace(/nevada$/, "") === c &&
      id.endsWith("-nevada") === nevada,
  );
  if (exact) return exact;
  const n = c.match(/\d+/)?.[0];
  if (!n) return null;
  const byNumber = ids.filter((id) => id.match(/\d+/)?.[0] === n);
  return (
    byNumber.find((id) => id.endsWith("-nevada") === nevada) ??
    byNumber[0] ??
    null
  );
}

/** Route ids close to what was asked for, for did_you_mean. */
export function suggestRoutes(graph, text, n = 5) {
  const c = compact(text);
  const num = c.match(/\d+/)?.[0];
  const routes = graph.routeIds.map((id) => ({
    id,
    name: `${graph.routes[id].short}${id.endsWith("-nevada") ? " (Nevada)" : ""}`,
    kind: "route",
  }));
  const close = routes.filter(
    (r) =>
      (num && r.id.match(/\d+/)?.[0] === num) ||
      (c.length >= 2 && compact(r.id).startsWith(c.slice(0, 2))),
  );
  return (close.length ? close : routes).slice(0, n);
}

/**
 * One place by id: the id itself, the exact name when one place has it, or the
 * one clear near miss (labeled). Returns { place, resolvedFrom } or null.
 */
export function resolvePlace(graph, text) {
  const id = String(text ?? "").trim();
  if (!id) return null;
  let p = isSafeId(id) ? graph.placeById.get(id) : null;
  if (!p) {
    const key = id.toLowerCase();
    const hits = graph.places.filter((x) => x.name.toLowerCase() === key);
    if (hits.length === 1) p = hits[0];
  }
  if (p) return { place: p, resolvedFrom: null };
  const close = closestPlace(graph, id);
  return close ? { place: close, resolvedFrom: id } : null;
}

// The places route_stops lists for a route and window, by graph (snapshot) and
// arguments: both directions, every stop it returns, paged to the end.
const routeMemo = new WeakMap();

async function routeMembers(ctx, route, fromMile, toMile) {
  let memo = routeMemo.get(ctx.graph);
  if (!memo) routeMemo.set(ctx.graph, (memo = new Map()));
  const key = `${route}|${fromMile ?? ""}|${toMile ?? ""}`;
  if (!memo.has(key))
    memo.set(
      key,
      (async () => {
        const tool = routeStops(ctx);
        const members = new Map();
        for (const direction of ["north", "south"]) {
          let offset = 0;
          for (let guard = 0; guard < 100; guard++) {
            const args = tool.inputSchema.parse({
              route,
              direction,
              ...(fromMile != null ? { from_mile: fromMile } : {}),
              ...(toMile != null ? { to_mile: toMile } : {}),
              dog_friendly_only: false,
              limit: 50,
              offset,
              response_format: "json",
            });
            const page = (await tool.handler(args)).structuredContent;
            for (const s of page.stops ?? [])
              if (!members.has(s.id))
                members.set(s.id, {
                  mile: s.mile ?? null,
                  off_route_miles: s.off_route_miles ?? null,
                });
            if (!page.has_more || !page.count) break;
            offset = page.next_offset ?? offset + page.count;
          }
        }
        return members;
      })(),
    );
  return memo.get(key);
}

const noMatch = (fields) => ({ noMatch: { outcome: "no_match", ...fields } });

/**
 * Resolves the scope of a change question. Returns
 *   { kind, label, center, radius, members: Map(placeId -> { distance_miles?, mile?, off_route_miles? }),
 *     place?, town?, route?, from_mile?, to_mile?, page_url }
 * or { noMatch } (outcome, code, asked, title, message, did_you_mean, next).
 * kind: place, route, town (a city, county or neighborhood with a radius), area (an
 * area's or region's own members) or point.
 */
export async function resolveChangeScope(ctx, args) {
  const g = ctx.graph;
  const site = g.site.url.replace(/\/+$/, "");
  const given = ["place_id", "route", "place", "near"].filter(
    (k) => args[k] != null,
  );
  if (given.length > 1 && (args.place_id != null || args.route != null))
    return {
      noMatch: {
        outcome: "bad_input",
        code: "invalid",
        asked: given.join(", "),
        title: "More than one scope given",
        message: `Give one of place_id, route, or a place or point; this call gave ${given.join(" and ")}.`,
        did_you_mean: [],
        next: [
          'place_id="carmel-beach" for one place',
          'route="i-5" with from_mile and to_mile for a stretch of highway',
          'place="Lake Tahoe" for a town, county, area or region',
        ],
      },
    };
  if (args.place_id != null) {
    const hit = resolvePlace(g, args.place_id);
    if (!hit) {
      const did_you_mean = suggestPlaces(g, args.place_id);
      return noMatch({
        code: "not_found",
        asked: args.place_id,
        title: `No place with id "${args.place_id}" in the data`,
        message: `No place with id or name "${args.place_id}" in the data.`,
        did_you_mean,
        next: [
          ...(did_you_mean[0]
            ? [`Call again with place_id="${did_you_mean[0].id}"`]
            : []),
          'dogpolicies_search_places with query="…" finds a place by its own name',
          'place="<town>" follows every place around a town instead',
        ],
      });
    }
    const { place, resolvedFrom } = hit;
    return {
      kind: "place",
      place,
      label: resolvedFrom
        ? `${place.name} (closest match to "${resolvedFrom}")`
        : place.name,
      center: place.geo ?? null,
      radius: 0,
      members: new Map([[place.id, { distance_miles: 0 }]]),
      page_url: place.url,
    };
  }
  if (args.route != null) {
    const id = resolveRoute(g, args.route);
    if (!id)
      return noMatch({
        code: "not_found",
        asked: String(args.route),
        title: `No route "${args.route}" in the data`,
        message: `"${args.route}" is not a highway the data covers. The routes are ${g.routeIds.join(", ")}.`,
        did_you_mean: suggestRoutes(g, args.route),
        next: [
          'route="i-5" (or us-101, highway-1, i-15, i-80, us-50 and the Nevada routes ending in -nevada)',
        ],
      });
    const route = g.routes[id];
    const from = args.from_mile ?? null;
    const to = args.to_mile ?? null;
    const members = await routeMembers(ctx, id, from, to);
    const window =
      from != null || to != null
        ? `, miles ${Math.round(Math.min(from ?? 0, to ?? route.length_miles))}–${Math.round(Math.max(from ?? 0, to ?? route.length_miles))}`
        : "";
    return {
      kind: "route",
      route: id,
      from_mile: from,
      to_mile: to,
      label: `${route.short}${id.endsWith("-nevada") ? " in Nevada" : ""}${window}`,
      center: null,
      radius: 0,
      members,
      page_url: `${site}/road-trips/${id}/`,
    };
  }
  const scope = resolveScope(ctx, args);
  if (scope.noMatch) return scope;
  const members = new Map(
    scope
      .within(g.places)
      .map((x) => [x.place.id, { distance_miles: x.distance }]),
  );
  return {
    kind: scope.isArea ? "area" : args.near ? "point" : "town",
    town: scope.town,
    label: scope.label,
    center: scope.center,
    radius: scope.radius,
    members,
    page_url: null,
  };
}

/** The rule-change log entries for places in scope, or for the brand of a hotel in scope. */
export function ruleChangesIn(ctx, members, since) {
  const g = ctx.graph;
  const brands = new Set();
  for (const id of members.keys()) {
    const b = g.placeById.get(id)?.brand_id;
    if (b) brands.add(b);
  }
  return g.changes.filter(
    (c) =>
      c.date >= since &&
      ((c.placeId && members.has(c.placeId)) ||
        (c.brandId && brands.has(c.brandId))),
  );
}
