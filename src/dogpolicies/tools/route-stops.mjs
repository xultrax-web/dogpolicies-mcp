import * as z from "zod/v4";
import { READ_ONLY } from "../../core/server.mjs";
import { nearestOnLine } from "../../core/geo.mjs";
import { evaluateHotel, feeLine } from "../vendor/match.mjs";
import { STATE_NAME, isStay } from "../stay.mjs";
import { forMatcher } from "./find-hotels.mjs";
import {
  ListOutput,
  listResponse,
  pageSchema,
  stayCriteriaSchema,
  summary,
} from "./common.mjs";
import {
  MILE_M,
  axisFields,
  axisOf,
  calibrationOf,
  isFamilyStop,
  pairLine,
  pairRow,
  pairedIn,
  positionOf,
  servesDirection,
} from "../i5.mjs";

export const routeStops = (ctx) => {
  const routes = ctx.graph.routes;
  const ROUTE_IDS = ctx.graph.routeIds;
  return {
    name: "dogpolicies_route_stops",
    title: "Dog stops along a highway",
    since: "0.1.0",
    cache: true,
    description: `Dog-friendly stops along a California or Nevada highway, in driving order: rest areas (Caltrans rest areas with pet areas; Nevada rest areas, where leashed dogs are allowed), travel stops with dog parks, hotels, cabin resorts and campgrounds or RV parks near the road (all checked against the dog's weight and the pet-fee budget) and parks or beaches that allow dogs.

Each stop has its mile on the route and its distance off the road. Each route covers one state and stops at the state line. California miles follow the Caltrans odometer: north on I-5 (from the Mexican border), US-101 (from Los Angeles), Highway 1 (from Dana Point) and I-15 (i-15, San Diego to Primm); east on I-80 (i-80, San Francisco to the Nevada line) and US-50 (us-50, West Sacramento to Stateline). Nevada routes count Nevada mileposts from the California line, matching the exit numbers: north on I-15 (i-15-nevada), east on I-80 (i-80-nevada) and US-50 (us-50-nevada, Stateline to Utah); north on US-95 (us-95-nevada, California line to Oregon) and US-93 (us-93-nevada, Hoover Dam to Idaho), whose miles include the stretches they share with other highways. Where Highway 1 runs on US-101, stops on that stretch say so in on_road. A starting point is set with from_mile or near, plus a direction; ahead_miles limits the window to that many miles from the start in the direction of travel.

On I-5 in California each stop also carries its position on the I-5 centerline in meters from San Ysidro (s_m), miles_ahead of the start along the direction of travel, the side of the road it serves (right or left of northbound travel, or both), its distance off the freeway, the road's elevation in meters and the stretch (strip) it is in, plus restrooms, water, pet_area, dog_park and hours as its official source states them. With family=true only stops whose official source states restrooms and a pet area or dog park are returned. With paired=true the result also lists paired stops: a freeway exit in the window with places to stop for people nearby (located through OpenStreetMap, counted by kind, never named and not verified for restrooms) matched to the nearest DogPolicies place that allows dogs within about a mile, with its rule and source.

Routes covered: ${ROUTE_IDS.map((id) => `${routes[id].short} (${id}, ${routes[id].length_miles} miles)`).join(", ")}.

Examples:
  - "Driving north on I-5 from Los Angeles with a 70 lb dog, where can we stop?" -> near={lat:34.05, lon:-118.24}, direction="north", dog_weight_lb=70
  - "Pet areas on the Grapevine" -> from_mile=170, to_mile=222, kinds=["rest_area","park"]
  - "Next place in 40 miles where the whole family can use a restroom, dog included, northbound at Harris Ranch" -> near={lat:36.25, lon:-120.25}, direction="north", ahead_miles=40, family=true
  - "Exits with a coffee shop and a park for the dog between Sacramento and Redding" -> from_mile=520, to_mile=680, paired=true
  - "Heading south on 101 from San Francisco to Santa Barbara, where can the dog run?" -> route="us-101", near={lat:37.77, lon:-122.42}, to_mile=100, direction="south"
  - "Dog-friendly hotel near Redding under $40 a night" -> near={lat:40.59, lon:-122.39}, kinds=["lodging"], max_total_fee=40
  - "Driving I-80 east from Reno with a dog, where can we stop?" -> route="i-80-nevada", near={lat:39.53, lon:-119.81}, direction="east"`,
    inputSchema: z.strictObject({
      route: z.enum(ROUTE_IDS).default("i-5").describe("Route id"),
      near: z
        .strictObject({
          lat: z
            .number()
            .min(32)
            .max(42.1)
            .describe("Latitude of the starting point"),
          lon: z
            .number()
            .min(-124.5)
            .max(-114)
            .describe("Longitude of the starting point"),
        })
        .optional()
        .describe("Start from the route mile nearest this point"),
      from_mile: z
        .number()
        .min(0)
        .max(1000)
        .optional()
        .describe("Start at this route mile"),
      to_mile: z
        .number()
        .min(0)
        .max(1000)
        .optional()
        .describe("Stop at this route mile"),
      ahead_miles: z
        .number()
        .min(1)
        .max(1000)
        .optional()
        .describe(
          "Window in miles from the start (near or from_mile) in the direction of travel; an alternative to to_mile",
        ),
      direction: z
        .enum(["north", "south", "east", "west"])
        .default("north")
        .describe(
          "Direction of travel. Route miles increase going north, or east on I-80 and US-50; north and east both mean increasing miles",
        ),
      kinds: z
        .array(
          z.enum([
            "rest_area",
            "stop",
            "lodging",
            "campground",
            "cabins",
            "park",
            "beach",
            "trail",
            "restaurant",
          ]),
        )
        .min(1)
        .optional()
        .describe("Kinds of stops to include; all by default"),
      family: z
        .boolean()
        .default(false)
        .describe(
          "Only stops whose official source states restrooms and a pet area or dog park (I-5 in California)",
        ),
      paired: z
        .boolean()
        .default(false)
        .describe(
          "Also list the paired stops in the window: an exit with people-stops nearby and the nearest dog-legal place (I-5 in California)",
        ),
      dog_friendly_only: z
        .boolean()
        .default(true)
        .describe("Leave out stops where dogs are not allowed"),
      ...stayCriteriaSchema,
      ...pageSchema,
    }),
    outputSchema: ListOutput("stops", {
      route: z.string(),
      guide: z.string(),
      start: z
        .looseObject({ mile: z.number(), s_m: z.number().nullable() })
        .optional(),
      paired_stops: z.array(z.looseObject({})).optional(),
    }),
    annotations: READ_ONLY,
    handler: async (args) => {
      const route = routes[args.route];
      const today = ctx.today();
      const axis = axisOf(route);
      // North and east mean increasing route miles; south and west, decreasing.
      const ahead = ["north", "east"].includes(args.direction);
      const eastWest = route.heading === "east";
      const bound = ahead
        ? eastWest
          ? "east"
          : "north"
        : eastWest
          ? "west"
          : "south";
      const start =
        args.from_mile ??
        (args.near
          ? (nearestOnLine(route.points, args.near).mile ?? 0)
          : ahead
            ? 0
            : route.length_miles);
      const end =
        args.to_mile ??
        (args.ahead_miles != null
          ? Math.min(
              route.length_miles,
              Math.max(0, start + (ahead ? 1 : -1) * args.ahead_miles),
            )
          : ahead
            ? route.length_miles
            : 0);
      const [lo, hi] = [Math.min(start, end), Math.max(start, end)];
      const criteria = {
        weightLb: args.dog_weight_lb,
        dogs: args.dogs,
        nights: args.nights,
        maxTotalFee: args.max_total_fee,
      };
      // On the axis route the window is measured in s, the start from the
      // Caltrans line through the calibration table.
      const cal = axis ? calibrationOf(axis) : null;
      const startS = cal ? Math.round(cal.mileToS(start)) : null;
      const loS = cal ? Math.round(cal.mileToS(lo)) : null;
      const hiS = cal ? Math.round(cal.mileToS(hi)) : null;
      let stops = axis
        ? route.stops.filter((x) =>
            x.s_m != null
              ? x.s_m >= loS && x.s_m <= hiS
              : x.mile >= lo && x.mile <= hi,
          )
        : route.stops.filter((x) => x.mile >= lo && x.mile <= hi);
      if (args.kinds)
        stops = stops.filter((x) => args.kinds.includes(x.place.type));
      if (args.dog_friendly_only)
        stops = stops.filter((x) => x.place.status !== "no");
      if (args.family) stops = stops.filter((x) => isFamilyStop(x.place));
      // A rest area on the other side of a divided freeway is not a stop for this trip.
      stops = stops.filter((x) =>
        axis
          ? servesDirection(x, ahead)
          : !x.side || x.side === (ahead ? "ahead" : "back"),
      );
      if (axis)
        stops.sort((a, b) => (a.s_m ?? 0) - (b.s_m ?? 0) || a.mile - b.mile);
      const rows = [];
      for (const x of stops) {
        const p = x.place;
        let extra = {};
        if (isStay(p)) {
          const r = evaluateHotel(forMatcher(p), criteria);
          if (r.verdict === "excluded") continue;
          extra = {
            verdict: r.verdict,
            fee: feeLine(r.fee, { nights: args.nights }),
            reasons: r.reasons,
          };
        }
        rows.push({ x, extra });
      }
      if (!ahead) rows.reverse();
      const page = rows
        .slice(args.offset, args.offset + args.limit)
        .map(({ x, extra }) =>
          summary(x.place, today, {
            mile: x.mile,
            off_route_miles: x.off_miles,
            on_road: x.via ?? route.short,
            exit: x.place.exit ?? null,
            ...(axis ? axisFields(x, { startS, ahead }) : {}),
            ...extra,
          }),
        );
      const paired =
        axis && args.paired
          ? pairedIn(axis, loS, hiS)
              .map((pr) => pairRow(pr, ctx.graph))
              .map((r) => ({
                ...r,
                miles_ahead:
                  Math.round(
                    (((ahead ? 1 : -1) * (r.exit.s - startS)) / MILE_M) * 10,
                  ) / 10,
              }))
              .sort((a, b) => a.miles_ahead - b.miles_ahead)
              .filter((r) => r.miles_ahead >= 0)
          : null;
      const familyNote = args.family
        ? " A family stop states restrooms and a pet area or dog park in its official source."
        : "";
      return listResponse(ctx, {
        format: args.response_format,
        total: rows.length,
        offset: args.offset,
        items: page,
        key: "stops",
        header: `# ${rows.length} ${args.family ? "family " : "dog "}stops on ${route.short} in ${STATE_NAME[route.state]}, miles ${Math.round(lo)}–${Math.round(hi)} heading ${bound}${axis ? ` (s ${Math.round(startS).toLocaleString("en-US")} m from San Ysidro at the start)` : ""}${familyNote}${
          paired
            ? `\n\n## ${paired.length} paired stops in the window\n\n${paired.map(pairLine).join("\n") || "(none)"}\n\nExit numbers, names and people-stop counts are OpenStreetMap data (ODbL, © OpenStreetMap contributors); restrooms at a people-stop are not verified.`
            : ""
        }`,
        extra: {
          route: route.short,
          from_mile: Math.round(start * 10) / 10,
          direction: bound,
          guide: `${ctx.graph.site.url}/road-trips/${args.route}/`,
          ...(axis
            ? {
                start: { mile: Math.round(start * 10) / 10, s_m: startS },
                axis_version: axis.version,
              }
            : {}),
          ...(paired ? { paired_stops: paired } : {}),
        },
      });
    },
  };
};
