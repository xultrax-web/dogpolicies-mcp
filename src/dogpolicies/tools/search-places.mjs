import * as z from "zod/v4";
import { READ_ONLY } from "../../core/server.mjs";
import {
  offTopic,
  offTopicFields,
  outsideCoverage,
  outsideFields,
} from "./coverage.mjs";
import {
  ListOutput,
  OFF_LEASH,
  answer,
  noMatchText,
  filterByLocation,
  listResponse,
  locationSchema,
  matchesText,
  norm,
  pageSchema,
  resolveTown,
  suggestPlaces,
  suggestTowns,
  suggestionLines,
  summary,
} from "./common.mjs";
import { KIND_SYNONYMS, choice, flag, keyOf } from "./tolerant.mjs";
import {
  GENERIC,
  hasWords,
  inTown,
  parseQuery,
  placeText as hay,
} from "./query-words.mjs";

const TYPES = [
  "lodging",
  "campground",
  "cabins",
  "beach",
  "park",
  "trail",
  "restaurant",
  "rest_area",
  "stop",
];

export const searchPlaces = (ctx) => ({
  name: "dogpolicies_search_places",
  title: "Search places",
  since: "0.1.0",
  cache: true,
  description: `Can my dog go to this place, or which parks, beaches, trails, campgrounds or patios allow dogs: "Can I bring my dog to Point Lobos?", "state parks in Marin that allow dogs", "off-leash beaches near San Diego"?
Answers for one named place or a filtered list of one kind; each result's id names the place's full record, with every rule and source.
Inputs: query (name, city or brand; words like "cabins", "hikes", "wineries" or "dog friendly hotels in Carmel" are read as the kind and the place), type (lodging, campground incl. RV parks, cabins, beach, park, trail, restaurant, rest_area, stop; "hotel", "dog park" or "hike" are read as these), dogs_allowed, off_leash, state "CA" or "NV", county without "County", area (lake-tahoe, big-sur, east-bay), or near={lat, lon}.
Each result: yes, yes_restricted, no or varies, the rule in a sentence, verified date, URL and id. No match is an answer (outcome no_match) with did_you_mean, nearest and next. Nevada coverage is thin.

Examples:
  - "Off-leash beaches near San Diego" -> type="beach", off_leash=true, near={lat:32.72, lon:-117.16}
  - "Can I bring my dog to Point Lobos?" -> query="Point Lobos"
  - "State parks in Marin County that allow dogs" -> type="park", county="Marin", dogs_allowed=true
  - "Lake Tahoe beaches in Nevada that allow dogs" -> type="beach", state="NV", dogs_allowed=true
  - "Off-leash dog parks in Las Vegas" -> type="park", off_leash=true, county="Clark", state="NV"
  - "RV parks in Fresno County that take dogs" -> type="campground", county="Fresno", dogs_allowed=true
  - "Dog-friendly cabins in June Lake" -> type="cabins", query="June Lake", dogs_allowed=true (query="June Lake cabins" works too)
  - "Restaurants with a dog-friendly patio in Alameda" -> type="restaurant", query="Alameda"`,
  inputSchema: z.strictObject({
    query: z
      .string()
      .min(2)
      .max(100)
      .optional()
      .describe("Words to match in the name, city, county or brand"),
    type: choice(TYPES, KIND_SYNONYMS)
      .optional()
      .describe(
        "Kind of place; campground covers campgrounds and RV parks (some also rent cabins), cabins covers cabin resorts with no campground, restaurant covers restaurants, cafes, bars, breweries and tasting rooms (dogs on the patio, by the owner's published policy), rest_area and stop are the roadside kinds",
      ),
    dogs_allowed: flag()
      .optional()
      .describe(
        "true: only places that allow dogs somewhere; false: only places that do not",
      ),
    off_leash: flag()
      .optional()
      .describe(
        "true: only places where the managing agency allows dogs off leash, at least at some times",
      ),
    ...locationSchema(ctx.graph),
    ...pageSchema,
  }),
  outputSchema: ListOutput("places"),
  annotations: READ_ONLY,
  handler: async ({
    query,
    type,
    dogs_allowed,
    off_leash,
    limit,
    offset,
    response_format,
    ...loc
  }) => {
    const today = ctx.today();
    // The filters beside the text: the same for every reading of the query.
    const run = (textPred, kinds, dogsImplied, offLeashImplied = false) => {
      let items = ctx.graph.places.filter(textPred);
      const types = type ? [type] : kinds;
      if (types?.length) items = items.filter((p) => types.includes(p.type));
      const dogs = dogs_allowed ?? (dogsImplied ? true : undefined);
      if (dogs === true)
        items = items.filter((p) =>
          ["yes", "yes_restricted"].includes(p.status),
        );
      if (dogs === false) items = items.filter((p) => p.status === "no");
      if (off_leash ?? offLeashImplied)
        items = items.filter((p) => OFF_LEASH.has(p.facts.leash?.value));
      return filterByLocation(items, loc);
    };
    // The words as given first: a name that matches is never second-guessed.
    let located = run((p) => matchesText(p, query), null, false);
    // Nothing by that name: a question about somewhere outside California and
    // Nevada, or about something other than dogs, is said so before any looser
    // reading offers unrelated California places.
    if (!located.length) {
      const where = [query && parseQuery(query).name, query, loc.county, loc.area]
        .filter((t) => typeof t === "string" && t);
      const outside =
        where.map((t) => outsideCoverage(ctx.graph, t)).find(Boolean) ?? null;
      const topic = query ? offTopic(query) : null;
      const fields = topic
        ? offTopicFields(ctx.graph, topic, outside, query)
        : outside
          ? outsideFields(ctx.graph, outside)
          : null;
      if (fields)
        return answer({
          ...fields,
          shape: {
            ...ctx.citations.envelope(ctx.graph.as_of),
            total: 0,
            count: 0,
            offset,
            has_more: false,
            places: [],
          },
          nearest: fields.nearest.length ? fields.nearest : undefined,
          format: response_format,
          text: noMatchText(ctx, {
            title: fields.title,
            message: fields.message,
            next: fields.next,
          }),
        });
    }
    let read = null; // how a free-text query was read: { query, type, dogs_allowed }
    let partial = null; // what a looser reading dropped
    let asked = query;
    if (!located.length && query) {
      const q = parseQuery(query);
      if (q.changed) {
        asked = q.name || query;
        const kinds = q.kinds;
        const leashed = q.offLeash;
        const byName = q.name ? (p) => hasWords(p, q.name) : () => true;
        const as = {
          query: q.name || null,
          type: type ?? kinds[0] ?? null,
          ...(q.dogs ? { dogs_allowed: true } : {}),
          ...(leashed ? { off_leash: true } : {}),
        };
        located = run(byName, kinds, q.dogs, leashed);
        let town = null;
        if (!located.length && q.name) {
          town = resolveTown(ctx.graph, q.name);
          if (town) located = run(inTown(town), kinds, q.dogs, leashed);
        }
        // the town's own places before the rest of its county
        if (located.length && q.name && !loc.near)
          located = [...located].sort(
            (a, b) =>
              (norm(b.place.city) === q.name) - (norm(a.place.city) === q.name),
          );
        if (located.length) read = as;
        // the kind found nothing there: the place without the kind, said so
        if (!located.length && (kinds.length || type) && q.name) {
          located = run(town ? inTown(town) : byName, [], q.dogs, leashed);
          if (located.length) {
            read = as;
            partial = {
              dropped: `no ${type ?? kinds.join(" or ")} matched`,
              what: `places matching "${q.name}"`,
            };
          }
        }
        // any distinctive word of the name: the best-matching places, said so
        const tokens = q.name
          .split(" ")
          .filter((w) => w.length >= 3 && !GENERIC.has(w));
        if (!located.length && tokens.length) {
          for (const kindSet of kinds.length || type ? [kinds, []] : [[]]) {
            const scored = run(() => true, kindSet, q.dogs, leashed)
              .map((x) => ({
                x,
                hit: tokens.filter((t) => hay(x.place).includes(t)),
              }))
              .filter((s) => s.hit.length);
            if (!scored.length) continue;
            const best = Math.max(...scored.map((s) => s.hit.length));
            const top = scored.filter((s) => s.hit.length === best);
            located = top.map((s) => s.x);
            const matched = tokens.filter((t) =>
              top.some((s) => s.hit.includes(t)),
            );
            read = as;
            partial = {
              dropped: `no place matches every word of "${q.name}"`,
              what: `places matching ${matched.map((t) => `"${t}"`).join(" and ")}${
                matched.length < tokens.length
                  ? `, not ${tokens
                      .filter((t) => !matched.includes(t))
                      .map((t) => `"${t}"`)
                      .join(" or ")}`
                  : ""
              }`,
              matched_terms: matched,
            };
            break;
          }
        }
      }
    }
    const page = located
      .slice(offset, offset + limit)
      .map(({ place, distance }) =>
        summary(
          place,
          today,
          distance != null ? { distance_miles: distance } : {},
        ),
      );
    // Nothing matched: close matches and what to call next, never a dead end.
    let extra = {};
    let emptyLines = [];
    if (!located.length) {
      const town = asked ? resolveTown(ctx.graph, asked) : null;
      // close place matches first (a misspelled name), then towns, then the rest
      const places = asked ? suggestPlaces(ctx.graph, asked, 5) : [];
      const did_you_mean = [
        ...places.filter((p) => p.close_match),
        ...(asked && !town ? suggestTowns(ctx.graph, asked, 3) : []),
        ...places.filter((p) => !p.close_match),
      ];
      const filters = [
        type && `type=${type}`,
        dogs_allowed !== undefined && `dogs_allowed=${dogs_allowed}`,
        off_leash && "off_leash=true",
        loc.state && `state=${loc.state}`,
        loc.county && `county=${loc.county}`,
        loc.region && `region=${loc.region}`,
        loc.area && `area=${loc.area}`,
        loc.near && `near within ${loc.near.radius_miles} miles`,
      ].filter(Boolean);
      const next = [
        town &&
          `dogpolicies_near with place="${town.name}" lists everything for dogs around it, grouped by kind`,
        query &&
          !town &&
          "dogpolicies_near with the nearest town or county lists everything for dogs around it; a point works too (near={lat, lon})",
        type && "Call again without type",
        (dogs_allowed !== undefined || off_leash) &&
          "Drop dogs_allowed or off_leash",
        loc.near && `Widen near.radius_miles (now ${loc.near.radius_miles})`,
        (loc.county || loc.region || loc.area) &&
          "Try the neighboring county, or the region",
        !query &&
          !filters.length &&
          'Give a query, a type or a location: query="Carmel Beach", type="beach", county="Monterey"',
      ].filter(Boolean);
      extra = {
        outcome: "no_match",
        code: "not_found",
        message: `No place in the data matches${query ? ` "${query}"` : ""}${filters.length ? ` with ${filters.join(", ")}` : ""}.`,
        did_you_mean,
        next,
      };
      emptyLines = suggestionLines({ did_you_mean, next });
    } else if (read) {
      const as = [
        read.type && `type=${read.type}`,
        read.query && `query="${read.query}"`,
        read.dogs_allowed && "dogs_allowed=true",
        read.off_leash && "off_leash=true",
      ]
        .filter(Boolean)
        .join(", ");
      extra = {
        query_read: read,
        ...(partial
          ? {
              outcome: "partial",
              code: "partial_match",
              message: `Read "${query}" as ${as}. ${partial.dropped[0].toUpperCase()}${partial.dropped.slice(1)}, so these are ${partial.what}.`,
              ...(partial.matched_terms
                ? { matched_terms: partial.matched_terms }
                : {}),
            }
          : { message: `Read "${query}" as ${as}.` }),
      };
    }
    return listResponse(ctx, {
      format: response_format,
      total: located.length,
      offset,
      items: page,
      key: "places",
      header: `# ${located.length} place${located.length === 1 ? "" : "s"} found${
        extra.message && located.length
          ? `

${extra.message}`
          : ""
      }`,
      extra,
      emptyLines,
    });
  },
});
