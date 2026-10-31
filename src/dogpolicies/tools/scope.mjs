// "Where" for the tools that take a town or a point: resolves the gazetteer
// name or uses the coordinates, and returns the places inside the radius,
// sorted by distance, with the label to print.

import * as z from "zod/v4";
import { fail } from "../../core/errors.mjs";
import { miles } from "../../core/geo.mjs";
import { STATE_NAME, countyName } from "../stay.mjs";
import { resolveTown } from "./common.mjs";

export const scopeSchema = {
  place: z
    .string()
    .min(2)
    .max(80)
    .optional()
    .describe(
      'A city or county in California or Nevada, e.g. "Monterey", "South Lake Tahoe", "Washoe County, NV" or "Las Vegas"',
    ),
  near: z
    .strictObject({
      lat: z.number().min(32).max(42.1).describe("Latitude"),
      lon: z.number().min(-124.5).max(-114).describe("Longitude"),
    })
    .optional()
    .describe("A point instead of a town; give one of place or near"),
  radius_miles: z
    .number()
    .min(1)
    .max(100)
    .default(15)
    .describe("Search radius in miles around the town or point"),
};

/**
 * Resolves the scope. Returns { center, label, radius, within(places) } or an
 * error result when neither a known town nor a point was given.
 */
export function resolveScope(ctx, { place, near, radius_miles }) {
  let center = near ?? null;
  let label = near ? `${near.lat}, ${near.lon}` : null;
  let town = null;
  if (!center && place) {
    town = resolveTown(ctx.graph, place);
    if (!town)
      return {
        error: fail(
          "not_found",
          `No town or county named "${place}" in the data. Try the county name, a nearby larger city, or give near={lat, lon}.`,
        ),
      };
    center = { lat: town.lat, lon: town.lon };
    label =
      town.kind === "county"
        ? `${countyName(town.name)}, ${STATE_NAME[town.state]}`
        : `${town.name}, ${town.state}`;
  }
  if (!center)
    return {
      error: fail(
        "invalid",
        "Give a place (town or county) or near={lat, lon}.",
      ),
    };
  const radius = radius_miles ?? 15;
  const within = (places) =>
    places
      .filter((p) => p.geo)
      .map((p) => ({
        place: p,
        distance: Math.round(miles(center, p.geo) * 10) / 10,
      }))
      .filter((x) => x.distance <= radius)
      .sort(
        (a, b) =>
          a.distance - b.distance || a.place.name.localeCompare(b.place.name),
      );
  return { center, label, radius, town, within };
}
