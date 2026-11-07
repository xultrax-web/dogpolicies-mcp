// "Where" for the tools that take a town or a point: resolves the gazetteer
// name or uses the coordinates, and returns the places inside the radius,
// sorted by distance, with the label to print. A name the gazetteer does not
// know is not an error: the scope carries close matches and what to try, and
// the tool answers with them.

import * as z from "zod/v4";
import { miles } from "../../core/geo.mjs";
import { STATE_NAME, countyName } from "../stay.mjs";
import { answer, noMatchText, resolveTown, suggestTowns } from "./common.mjs";

const num = () => z.coerce.number();

export const scopeSchema = {
  place: z
    .string()
    .min(2)
    .max(80)
    .optional()
    .describe(
      'A city, county, area, region or neighborhood in California or Nevada, e.g. "Monterey", "South Lake Tahoe", "Washoe County, NV", "Las Vegas", "East Bay", "Lake Tahoe", "Central Valley" or "Van Nuys". Small spelling slips are corrected and the answer says so.',
    ),
  near: z
    .strictObject({
      lat: num().min(32).max(42.1).describe("Latitude"),
      lon: num().min(-124.5).max(-114).describe("Longitude"),
    })
    .optional()
    .describe("A point instead of a town; give one of place or near"),
  radius_miles: num()
    .min(1)
    .max(100)
    .default(15)
    .describe(
      "Search radius in miles around the town or point (an area is its own boundary; the radius is ignored)",
    ),
};

/**
 * Resolves the scope. Returns { center, label, radius, town, within(places) },
 * or { noMatch } when the name is unknown or nothing was given: the tool
 * answers with its suggestions.
 */
export function resolveScope(ctx, { place, near, radius_miles }) {
  let center = near ?? null;
  let label = near ? `${near.lat}, ${near.lon}` : null;
  let town = null;
  if (!center && place) {
    town = resolveTown(ctx.graph, place);
    if (!town) {
      const did_you_mean = suggestTowns(ctx.graph, place);
      const example = did_you_mean[0]
        ? `place="${did_you_mean[0].name}${did_you_mean[0].state ? `, ${did_you_mean[0].state}` : ""}"`
        : 'place="Monterey"';
      return {
        noMatch: {
          outcome: "no_match",
          code: "not_found",
          asked: place,
          title: `No place named "${place}" in the data`,
          message: `"${place}" is not a town, county, area, region or neighborhood the data knows in California or Nevada.`,
          did_you_mean,
          next: [
            `Call again with the nearest larger town or the county, e.g. ${example}`,
            "Give near={lat, lon} for an exact point; the radius then does the rest",
            'dogpolicies_search_places with query="…" finds a place by its own name',
          ],
        },
      };
    }
    center = { lat: town.lat, lon: town.lon };
    label =
      town.kind === "county"
        ? `${countyName(town.name)}, ${STATE_NAME[town.state]}`
        : town.kind === "area" || town.kind === "region"
          ? town.name
          : `${town.name}, ${town.state}`;
    // a corrected slip says so, so the answer never silently swaps the town
    if (town.corrected_from) label += ` (closest match to "${place}")`;
  }
  if (!center)
    return {
      noMatch: {
        outcome: "bad_input",
        code: "invalid",
        asked: "",
        title: "No place or point given",
        message:
          "Give a place (a town, county, area or region) or near={lat, lon}.",
        did_you_mean: [],
        next: [
          'place="Monterey" or place="Washoe County, NV"',
          "near={lat: 36.6, lon: -121.9} with radius_miles",
        ],
      },
    };
  const radius = radius_miles ?? 15;
  // An area or a region is its member places (East Bay is the five-county
  // definition, not a circle), sorted by distance from its center for a stable
  // order.
  const isArea = town?.kind === "area" || town?.kind === "region";
  const member = (p) =>
    town.kind === "region" ? p.regionId === town.id : p.area_id === town.id;
  const within = (places, radiusOverride) =>
    (isArea ? places.filter(member) : places)
      .filter((p) => p.geo)
      .map((p) => ({
        place: p,
        distance: Math.round(miles(center, p.geo) * 10) / 10,
      }))
      .filter((x) => isArea || x.distance <= (radiusOverride ?? radius))
      .sort(
        (a, b) =>
          a.distance - b.distance || a.place.name.localeCompare(b.place.name),
      );
  return { center, label, radius, town, isArea, within };
}

/**
 * The answer for a scope that did not resolve: the tool passes the fields its
 * output contract requires (`shape`) and gets a result that passes the schema
 * and tells the model what to do next.
 */
export function scopeAnswer(ctx, noMatch, { format, shape }) {
  const { outcome, code, message, did_you_mean, next, title } = noMatch;
  return answer({
    outcome,
    code,
    message,
    shape: { ...ctx.citations.envelope(ctx.graph.as_of), ...shape },
    did_you_mean,
    next,
    format,
    text: noMatchText(ctx, { title, message, did_you_mean, next }),
  });
}
