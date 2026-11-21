// Emergency animal hospitals (R-29, 0.6.0): the nearest ones to a point, as answer items. Shared by
// dogpolicies_emergency_vet and the tools that name the nearest 24-hour hospital beside their answer
// (near, plan_trip, route_stops). Only where, when and the phone number: never medical advice.

import { miles } from "../../core/geo.mjs";
import { upcomingHolidays } from "./common.mjs";

/** The site page that lists every hospital with its source and checked date. */
export const vetPageUrl = (ctx, id) => `${ctx.graph.site.url.replace(/\/+$/, "")}/emergency-vets/${id ? `#${id}` : ""}`;

/** One hospital as an answer item, with its distance from the point asked about. */
export function vetItem(ctx, v, distance) {
  return {
    id: v.id,
    name: v.name,
    address: v.address,
    city: v.city,
    county: v.county,
    state: v.state,
    ...(v.zip ? { zip: v.zip } : {}),
    geo: v.geo,
    phone: v.phone,
    website: v.website,
    emergency: v.emergency,
    ...(v.hours ? { hours: v.hours } : {}),
    ...(v.note ? { note: v.note } : {}),
    // Hours on a named day that has not passed, from the hospital's own page.
    ...(upcomingHolidays(v.holidays, ctx.today()).length
      ? { holiday_hours: upcomingHolidays(v.holidays, ctx.today()) }
      : {}),
    ...(distance != null ? { distance_miles: Math.round(distance * 10) / 10 } : {}),
    verified_at: v.verified_at,
    source_url: v.source_url,
    url: v.website,
    dogpolicies_url: vetPageUrl(ctx, v.id),
  };
}

/**
 * The `n` nearest hospitals to a point, nearest first, within `radius` miles (no limit when null).
 * `only24` keeps the ones open 24 hours every day.
 */
export function nearestVets(ctx, point, { n = 5, radius = null, only24 = false } = {}) {
  if (!point || typeof point.lat !== "number") return [];
  const out = [];
  for (const v of ctx.graph.vets ?? []) {
    if (only24 && v.emergency !== "24_7") continue;
    const d = miles(point, v.geo);
    if (radius == null || d <= radius) out.push({ v, d });
  }
  return out
    .sort((a, b) => a.d - b.d || a.v.name.localeCompare(b.v.name))
    .slice(0, n)
    .map(({ v, d }) => vetItem(ctx, v, d));
}

/** The nearest 24-hour hospital to a point, or null when the data has none. */
export const nearest24 = (ctx, point) => nearestVets(ctx, point, { n: 1, only24: true })[0] ?? null;

/** "Open 24 hours" or the published emergency hours. */
export const serviceText = (v) => (v.emergency === "24_7" ? "open 24 hours, every day" : `emergency hours: ${v.hours}`);

/** One line for a tool's text answer. */
export const vetLine = (v) =>
  `**${v.name}**, ${v.address}, ${v.city}, ${v.state} · ${v.phone} · ${serviceText(v)}${v.distance_miles != null ? ` · ${v.distance_miles} mi away (straight line)` : ""}${v.note ? ` · ${v.note}` : ""}${(v.holiday_hours ?? []).map((h) => ` · ${h.holiday ?? h.date}: ${h.open ? `open${h.hours ? `, ${h.hours}` : ""}` : "closed"}`).join("")}`;

/** The closing line every vet answer carries. */
export const VET_CAVEAT =
  "Call ahead before driving over: hours and services change, and this is not medical advice. Each hospital's service is from its own page, with the date it was read.";
