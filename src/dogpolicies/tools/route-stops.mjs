import * as z from "zod/v4";
import { READ_ONLY } from "../../core/server.mjs";
import { nearestOnLine } from "../../core/geo.mjs";
import { evaluateHotel, feeLine } from "../vendor/match.mjs";
import { STATE_NAME, isStay } from "../stay.mjs";
import { forMatcher } from "./find-hotels.mjs";
import {
  ListOutput,
  listResponse,
  num,
  pageSchema,
  stayCriteriaSchema,
  summary,
} from "./common.mjs";
import { closedNowOf, closuresFor } from "./conditions-source.mjs";
import { closureLine } from "../vendor/closures.mjs";
import {
  DIRECTION_SYNONYMS,
  KINDS,
  KIND_SYNONYMS,
  choice,
  choiceList,
  flag,
  idChoice,
  pointInput,
} from "./tolerant.mjs";
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

/**
 * What people call each route: "I-5", "I5", "Interstate 5", "101", "Highway 101",
 * "Hwy 1", "PCH", "I-80 Nevada". A bare number is the California road unless the
 * words say Nevada; routes are listed California first, and the first reading wins.
 */
export function routeNames(routes) {
  const names = {};
  const extra = [];
  for (const [id, r] of Object.entries(routes)) {
    const nevada = id.endsWith("-nevada");
    const base = id.replace(/-nevada$/, "");
    const n = base.match(/(\d+)$/)[1];
    const forms = new Set([
      r.short,
      base.replace(/-/g, " "),
      `${base.split("-")[0]}${n}`,
    ]);
    if (base.startsWith("i-")) {
      forms.add(`interstate ${n}`);
      forms.add(`i ${n}`);
    } else {
      for (const w of [
        "us",
        "highway",
        "hwy",
        "route",
        "rt",
        "state route",
        "sr",
        "ca",
        "us highway",
        "us route",
      ])
        forms.add(`${w} ${n}`);
    }
    if (base === "highway-1")
      for (const w of [
        "pch",
        "pacific coast highway",
        "pacific coast hwy",
        "coast highway",
        "cabrillo highway",
      ])
        forms.add(w);
    const all = [...forms];
    if (nevada) {
      const withState = all.flatMap((f) => [
        `${f} nevada`,
        `nevada ${f}`,
        `${f} nv`,
        `nv ${f}`,
        `${f} in nevada`,
      ]);
      names[id] = [r.long ?? r.short, ...withState];
      // a route that exists only in Nevada answers to its plain names too
      if (!routes[base]) extra.push(...all.map((f) => [f, id]), [n, id]);
    } else {
      names[id] = all;
      extra.push([n, id]);
    }
  }
  return { names, extra };
}

export const routeStops = (ctx) => {
  const routes = ctx.graph.routes;
  const ROUTE_IDS = ctx.graph.routeIds;
  return {
    name: "dogpolicies_route_stops",
    title: "Dog stops along a highway",
    since: "0.1.0",
    cache: true,
    // Closed rest areas come from a live feed: an answer holds five minutes.
    cacheTtlMs: 5 * 60_000,
    description: `Where can we stop with the dog along this highway, in driving order: rest areas, travel stops with dog parks, hotels, campgrounds, parks and beaches, each with its mile and distance off the road?
For a drive on I-5, US-101, Highway 1, I-15, I-80 or US-50 in California, or I-15, I-80, US-50, US-95 or US-93 in Nevada (each route stops at the state line). It lists stops, not closures or chain controls.
Inputs: route (default i-5), a start as near={lat, lon} or from_mile, direction (north, south, east, west), ahead_miles or to_mile, dog_weight_lb and max_total_fee for stays. On I-5 add family=true (restrooms and a pet area stated by the source) or paired=true (an exit with places for people, plus the nearest dog-legal place).
Each stop has its mile, side, distance off the road, dog rule, source URL and verified date; stays carry the whole-stay pet fee. On I-5 a rest area Caltrans reports fully closed right now carries closed_now (Caltrans' reason and end time), is left out of the "first open stop" in the text, and stays in the list.

Examples:
  - "Driving north on I-5 from Los Angeles with a 70 lb dog, where can we stop?" -> near={lat:34.05, lon:-118.24}, direction="north", dog_weight_lb=70
  - "Pet areas on the Grapevine" -> from_mile=170, to_mile=222, kinds=["rest_area","park"]
  - "Next restroom stop for the whole family, dog included, 40 miles north of Harris Ranch" -> near={lat:36.25, lon:-120.25}, direction="north", ahead_miles=40, family=true
  - "Heading south on 101 from San Francisco, where can the dog run?" -> route="us-101", near={lat:37.77, lon:-122.42}, direction="south"
  - "Driving I-80 east from Reno with a dog" -> route="i-80-nevada", near={lat:39.53, lon:-119.81}, direction="east"`,
    inputSchema: z.strictObject({
      route: idChoice(
        ROUTE_IDS,
        routeNames(routes).names,
        routeNames(routes).extra,
        "i-5",
      ).describe(
        `Route id. Miles: California follows the Caltrans odometer (I-5 from the Mexican border, US-101 from Los Angeles, Highway 1 from Dana Point, I-15 San Diego to Primm, I-80 San Francisco to the Nevada line, US-50 West Sacramento to Stateline); Nevada routes count mileposts from the California line, matching exit numbers. Routes: ${ROUTE_IDS.map((id) => `${routes[id].short} (${id}, ${routes[id].length_miles} miles)`).join(", ")}`,
      ),
      near: z
        .preprocess(
          pointInput,
          z.strictObject({
            lat: num()
              .min(32)
              .max(42.1)
              .describe("Latitude of the starting point"),
            lon: num()
              .min(-124.5)
              .max(-114)
              .describe("Longitude of the starting point"),
          }),
        )
        .optional()
        .describe("Start from the route mile nearest this point"),
      from_mile: num()
        .min(0)
        .max(1000)
        .optional()
        .describe("Start at this route mile"),
      to_mile: num()
        .min(0)
        .max(1000)
        .optional()
        .describe("Stop at this route mile"),
      ahead_miles: num()
        .min(1)
        .max(1000)
        .optional()
        .describe(
          "Window in miles from the start (near or from_mile) in the direction of travel; an alternative to to_mile",
        ),
      direction: choice(
        ["north", "south", "east", "west"],
        DIRECTION_SYNONYMS,
        [],
        "north",
      ).describe(
        "Direction of travel. Route miles increase going north, or east on I-80 and US-50; north and east both mean increasing miles",
      ),
      kinds: choiceList(KINDS, KIND_SYNONYMS)
        .optional()
        .describe("Kinds of stops to include; all by default"),
      family: flag(false).describe(
        "Only stops whose official source states restrooms and a pet area or dog park (I-5 in California)",
      ),
      paired: flag(false).describe(
        "Also list the paired stops in the window: an exit with people-stops nearby and the nearest dog-legal place (I-5 in California)",
      ),
      dog_friendly_only: flag(true).describe(
        "Leave out stops where dogs are not allowed",
      ),
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
      const pageRows = rows.slice(args.offset, args.offset + args.limit);
      // Rest areas Caltrans reports closed now (I-5; none when the feed is unavailable).
      const usable =
        axis && pageRows.some(({ x }) => x.place.type === "rest_area")
          ? await closuresFor(ctx)
          : null;
      const page = pageRows.map(({ x, extra }) => {
        const closed = closedNowOf(x, usable);
        return summary(x.place, today, {
          mile: x.mile,
          off_route_miles: x.off_miles,
          on_road: x.via ?? route.short,
          exit: x.place.exit ?? null,
          ...(axis ? axisFields(x, { startS, ahead }) : {}),
          ...extra,
          ...(closed ? { closed_now: closed } : {}),
        });
      });
      const closedRows = page.filter((s) => s.closed_now);
      const firstOpen = closedRows.length
        ? page.find((s) => !s.closed_now && (s.miles_ahead ?? 0) >= 0)
        : null;
      const closedNote = closedRows.length
        ? [
            "",
            "",
            "## Closed now (Caltrans)",
            "",
            ...closedRows.map(
              (s) => `- ${s.name}: ${closureLine(s.closed_now)}`,
            ),
            "",
            `They stay in the list; skip them${firstOpen ? `: the first open stop is ${firstOpen.name}, ${firstOpen.miles_ahead} mi ahead` : ""}. Live Caltrans data read ${closedRows[0].closed_now.fetched_at}, not a verified rule; check quickmap.dot.ca.gov.`,
          ].join("\n")
        : "";
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
        header: `# ${rows.length} ${args.family ? "family " : "dog "}stops on ${route.short} in ${STATE_NAME[route.state]}, miles ${Math.round(lo)}–${Math.round(hi)} heading ${bound}${axis ? ` (s ${Math.round(startS).toLocaleString("en-US")} m from San Ysidro at the start)` : ""}${familyNote}${closedNote}${
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
