// The I-5 axis as the package sees it: the snapshot's routes["i-5"].axis
// carries the calibration table (Caltrans odometer mile <-> s meters from
// San Ysidro), the 11 California strips and the paired stops; every I-5 stop
// carries s_m, axis_side, elevation_m and strip. This module turns those into
// the windows and rows the tools return. Pure: no I/O.

import { nearestOnLine } from "../core/geo.mjs";

export const MILE_M = 1609.344;
export const I5 = "i-5";

/** The axis block of a route, or null when the route has none. */
export const axisOf = (route) => route?.axis ?? null;

/** Piecewise-linear interpolation over the calibration table, both ways. */
export function calibrationOf(axis) {
  const miles = axis.calibration.map((r) => r[0]);
  const ss = axis.calibration.map((r) => r[1]);
  const n = miles.length;
  const interp = (xs, ys, x) => {
    if (x <= xs[0])
      return ys[0] + ((x - xs[0]) * (ys[1] - ys[0])) / (xs[1] - xs[0]);
    if (x >= xs[n - 1])
      return (
        ys[n - 1] +
        ((x - xs[n - 1]) * (ys[n - 1] - ys[n - 2])) / (xs[n - 1] - xs[n - 2])
      );
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] <= x) lo = mid;
      else hi = mid;
    }
    const span = xs[hi] - xs[lo];
    return span ? ys[lo] + ((x - xs[lo]) * (ys[hi] - ys[lo])) / span : ys[lo];
  };
  return {
    sToMile: (s) => interp(ss, miles, s),
    mileToS: (mile) => interp(miles, ss, mile),
  };
}

/** The strip whose [startS, endS) holds s (strips overlap; the first wins). */
export function stripAt(axis, s) {
  for (const st of axis.strips) if (s >= st.startS && s < st.endS) return st;
  return s >= axis.strips.at(-1).endS ? axis.strips.at(-1) : axis.strips[0];
}

/** A strip by id or by a word of its name ("grapevine", "Kettleman"). */
export function findStrip(axis, text) {
  const q = (text ?? "").toLowerCase().trim();
  if (!q) return null;
  return (
    axis.strips.find((st) => st.id === q) ??
    axis.strips.find((st) => st.name.toLowerCase().includes(q)) ??
    null
  );
}

/**
 * Where a point is on I-5: snap to the route's Caltrans line for the mile,
 * then the calibration table for s. { mile, s, off_miles } or null when the
 * point is more than `maxOffMiles` from the road.
 */
export function positionOf(route, near, { maxOffMiles = 25 } = {}) {
  const axis = axisOf(route);
  if (!axis || !near) return null;
  const at = nearestOnLine(route.points, near);
  if (at.mile == null || at.offMiles > maxOffMiles) return null;
  const cal = calibrationOf(axis);
  return {
    mile: Math.round(at.mile * 10) / 10,
    s: Math.round(cal.mileToS(at.mile)),
    off_miles: Math.round(at.offMiles * 10) / 10,
  };
}

const hasRestrooms = (p) =>
  (p.facts?.amenities?.value ?? []).some((a) => /restroom/i.test(a));
const hasWater = (p) =>
  (p.facts?.amenities?.value ?? []).some((a) => /water/i.test(a));

/** Restrooms stated, a pet area or dog park stated, dogs allowed, open. */
export const isFamilyStop = (p) =>
  hasRestrooms(p) &&
  Boolean(p.facts?.petArea?.value || p.facts?.dogPark?.value) &&
  ["yes", "yes_restricted"].includes(p.status) &&
  (p.operating_status ?? "open") === "open";

/** The hours fact with its source, or null. */
export function hoursOf(p) {
  const row = (p.rows ?? []).find((r) => r.key === "hours");
  if (!row) return null;
  const src = (p.sources ?? [])[row.source - 1];
  return {
    text: row.value,
    source_url: src?.url ?? null,
    checked: src?.checked ?? null,
  };
}

/**
 * The axis fields for a stop row: s, miles ahead of a start (signed along
 * the direction of travel), side, distance off, elevation, and the family
 * facts with their sources.
 */
export function axisFields(stop, { startS = null, ahead = true } = {}) {
  const p = stop.place;
  const out = {
    s_m: stop.s_m ?? null,
    miles_ahead:
      stop.s_m != null && startS != null
        ? Math.round((((ahead ? 1 : -1) * (stop.s_m - startS)) / MILE_M) * 10) /
          10
        : null,
    side: stop.axis_side ?? null,
    off_miles: stop.off_miles ?? null,
    elevation_m: stop.elevation_m ?? null,
    strip: stop.strip ?? null,
    restrooms: hasRestrooms(p),
    water: hasWater(p),
    pet_area: Boolean(p.facts?.petArea?.value),
    dog_park: Boolean(p.facts?.dogPark?.value),
    hours: hoursOf(p),
    family_stop: isFamilyStop(p),
  };
  return out;
}

/**
 * True when the stop serves travel in this direction (ahead = northbound).
 * Only `side` makes a stop one-way: a rest area Caltrans lists for one
 * direction ("ahead" northbound, "back" southbound). Every other place, and a
 * rest area with no direction, serves both: a park or a hotel across the
 * freeway is an exit and an overpass away. `axis_side` is the bank of the
 * road the place sits on (src/lib/axis.mjs), kept for the answer's wording,
 * never a filter: reading it as one hid half the I-5 stops in each direction.
 */
export const servesDirection = (stop, ahead) =>
  stop.side == null || stop.side === (ahead ? "ahead" : "back");

/**
 * The window of stops from a start s in a direction: ahead means increasing
 * s. `aheadMiles` null means to the end of the route.
 */
export function windowStops(route, { startS, ahead, aheadMiles = null }) {
  const axis = axisOf(route);
  const end = ahead
    ? aheadMiles == null
      ? Infinity
      : startS + aheadMiles * MILE_M
    : aheadMiles == null
      ? -Infinity
      : startS - aheadMiles * MILE_M;
  const inWindow = (s) =>
    ahead ? s > startS && s <= end : s < startS && s >= end;
  const rows = route.stops.filter(
    (x) => x.s_m != null && inWindow(x.s_m) && servesDirection(x, ahead),
  );
  rows.sort((a, b) => (ahead ? a.s_m - b.s_m : b.s_m - a.s_m));
  void axis;
  return rows;
}

/** The paired stops whose exit lies in [lo, hi] s, in s order. */
export function pairedIn(axis, lo, hi) {
  return (axis.paired ?? []).filter((p) => p.exit.s >= lo && p.exit.s <= hi);
}

/** The sentence for a pair's people side: counts and kinds, never a name. */
export function peopleStopsText(c) {
  const parts = [];
  if (c.cafe)
    parts.push(c.cafe === 1 ? "a coffee shop" : `${c.cafe} coffee shops`);
  if (c.fast_food)
    parts.push(
      c.fast_food === 1
        ? "a fast-food place"
        : `${c.fast_food} fast-food places`,
    );
  if (c.fuel)
    parts.push(c.fuel === 1 ? "a gas station" : `${c.fuel} gas stations`);
  const list =
    parts.length > 1
      ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`
      : (parts[0] ?? "nothing");
  return `${list} within half a mile of the exit (locations from OpenStreetMap; restrooms not verified)`;
}

/** A pair as a tool returns it, with the dog-stop's current freshness-free summary fields. */
export function pairRow(pair, graph) {
  const p = graph.placeById.get(pair.dogStop.placeId);
  return {
    exit: pair.exit,
    people_stops: {
      ...pair.peopleStops,
      restrooms: "unverified",
      source: "OpenStreetMap",
    },
    dog_stop: {
      ...pair.dogStop,
      url: p?.url ?? null,
      markdown_url: p?.markdown_url ?? null,
    },
  };
}

/** The markdown line for a pair. */
export function pairLine(row) {
  const d = row.dog_stop;
  const leash =
    d.leash === "required"
      ? ", on leash"
      : d.leash?.startsWith("off_leash")
        ? ", off leash"
        : "";
  return [
    `- Exit ${row.exit.ref}${row.exit.name ? ` (${row.exit.name})` : ""}, mile ${row.exit.mile.toFixed(1)} (s ${row.exit.s.toLocaleString("en-US")} m): ${peopleStopsText(row.people_stops)}.`,
    `  Dogs: ${d.name}, about ${d.walkMin} minute${d.walkMin === 1 ? "" : "s"} on foot (${(d.distM / MILE_M).toFixed(1)} mi), ${d.answer === "yes" ? "dogs allowed" : "allowed with restrictions"}${leash}. ${d.citation}`,
  ].join("\n");
}
