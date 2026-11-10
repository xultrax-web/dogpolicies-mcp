// "Where" for the tools that take a town or a point: resolves the gazetteer
// name or uses the coordinates, and returns the places inside the radius,
// sorted by distance, with the label to print. A name the gazetteer does not
// know is not an error: the scope carries close matches and what to try, and
// the tool answers with them.

import * as z from "zod/v4";
import { miles } from "../../core/geo.mjs";
import { STATE_NAME, countyName } from "../stay.mjs";
import { answer, noMatchText, resolveTown, suggestTowns } from "./common.mjs";
import {
  offTopic,
  offTopicFields,
  outsideCoverage,
  outsideFields,
} from "./coverage.mjs";

const num = () => z.coerce.number();
const DEFAULT_RADIUS = 15;

export const scopeSchema = {
  place: z
    .string()
    .min(2)
    .max(80)
    .optional()
    .describe(
      'A city, county, area, region, neighborhood or airport in California or Nevada, e.g. "Monterey", "South Lake Tahoe", "Washoe County, NV", "Las Vegas", "East Bay", "Lake Tahoe", "Central Valley", "Van Nuys", "Koreatown", "Venice Beach", "the Mission", "DTLA", "SFO" or "LAX airport" (an airport searches 5 miles unless radius_miles is given). Accepts the place as people say it; small spelling slips ("Montery") are corrected and the answer says so.',
    ),
  near: z
    .strictObject({
      lat: num().min(32).max(42.1).describe("Latitude"),
      lon: num().min(-124.5).max(-114).describe("Longitude"),
    })
    .optional()
    .describe("A point as an alternative to a town: one of place or near"),
  radius_miles: num()
    .min(1)
    .max(100)
    .default(DEFAULT_RADIUS)
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
    // a place outside California and Nevada, said so (covered names win inside)
    const outside = outsideCoverage(ctx.graph, place);
    if (outside)
      return { noMatch: { ...outsideFields(ctx.graph, outside), asked: place } };
    const topic = offTopic(place);
    if (topic && !resolveTown(ctx.graph, place, { exact: true }))
      return { noMatch: { ...offTopicFields(ctx.graph, topic, null), asked: place } };
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
          message: `"${place}" is not a town, county, area, region, neighborhood or airport the data knows in California or Nevada.`,
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
          : town.kind === "airport"
            ? `${town.name} (${town.code}), ${town.state}`
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
  // An airport is a point with its own small default radius. The schema fills
  // in 15 when the caller gives none (the input shape stays as it was), so 15
  // on an airport reads as "not given"; any other radius is the caller's.
  const radius =
    town?.radius_miles && (radius_miles ?? DEFAULT_RADIUS) === DEFAULT_RADIUS
      ? town.radius_miles
      : (radius_miles ?? DEFAULT_RADIUS);
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
export function scopeAnswer(ctx, noMatch, { format, shape, placesOnly = false }) {
  const { outcome, code, message, next, title } = noMatch;
  let { did_you_mean, nearest } = noMatch;
  // a tool whose `nearest` holds place records (near) gets the closest towns in did_you_mean
  if (placesOnly && nearest?.length) {
    did_you_mean = nearest;
    nearest = undefined;
  }
  return answer({
    outcome,
    code,
    message,
    shape: { ...ctx.citations.envelope(ctx.graph.as_of), ...shape },
    did_you_mean,
    nearest: nearest?.length ? nearest : undefined,
    next,
    format,
    text: noMatchText(ctx, {
      title,
      message,
      did_you_mean: did_you_mean ?? [],
      next,
      extraLines: nearest?.length
        ? [
            "",
            "Closest covered towns:",
            ...nearest.map(
              (t) => `- ${t.name}, ${t.state} (${t.distance_miles} mi)`,
            ),
          ]
        : [],
    }),
  });
}
