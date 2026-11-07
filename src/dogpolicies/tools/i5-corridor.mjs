import * as z from "zod/v4";
import { READ_ONLY } from "../../core/server.mjs";
import { result } from "../../core/result.mjs";
import { LIMITS } from "../../config.mjs";
import {
  Envelope,
  OSM_ATTRIBUTION,
  OutcomeFields,
  PlaceItem,
  answer,
  summary,
  summaryLine,
} from "./common.mjs";
import {
  I5,
  MILE_M,
  axisFields,
  axisOf,
  calibrationOf,
  findStrip,
  isFamilyStop,
  pairLine,
  pairRow,
  pairedIn,
  positionOf,
  servesDirection,
  stripAt,
} from "../i5.mjs";

/**
 * The corridor tool: what is in a stretch of I-5 in California, by strip,
 * by mile range, or ahead of a point. It reads the same stops as
 * route_stops but answers by stretch: the eleven strips with their s and
 * mile ranges, what each holds, and the stops in the asked window with their
 * axis fields, family stops and paired stops.
 */
export const i5Corridor = (ctx) => {
  const route = ctx.graph.routes[I5];
  const axis = axisOf(route);
  const stripIds = axis ? axis.strips.map((st) => st.id) : ["none"];
  return {
    name: "dogpolicies_i5_corridor",
    title: "I-5 corridor by stretch",
    since: "0.3.0",
    cache: true,
    description: `The I-5 corridor in California as eleven named stretches (strips) on the I-5 centerline, from San Ysidro (s = 0 m) to the Oregon line (s ≈ 1,281,400 m), and the dog stops in any stretch, mile range or window ahead of a point. Every stop carries its s in meters from San Ysidro, its Caltrans odometer mile, the side of the road it serves (right or left of northbound travel, or both), its distance off the freeway, the road's elevation, and restrooms, water, pet area, dog park and hours as its official source states them. A family stop is one whose official source states restrooms and a pet area or dog park. A paired stop is a freeway exit with places to stop for people nearby (located through OpenStreetMap, counted by kind, never named and not verified for restrooms) matched to the nearest DogPolicies place that allows dogs within about a mile, with its rule and source.

With no stretch, miles or point, the result is the list of stretches with their s and mile ranges and stop counts. Strips: ${axis ? axis.strips.map((st) => `${st.id} (${st.name.replace(/^I-5 · /, "")})`).join(", ") : "none"}.

Examples:
  - "What is between the Grapevine and Kettleman?" -> strip="grapevine" (East LA to Wheeler Ridge) and strip="kern-westside" (Wheeler Ridge to Kettleman)
  - "The next 5 family stops northbound from Stockton" -> near={lat:37.95, lon:-121.29}, direction="north", family=true, limit=5
  - "Every stop between mile 300 and 340" -> from_mile=300, to_mile=340
  - "Exits with somewhere for people and a park for the dog in the Sacramento stretch" -> strip="sacramento", paired=true`,
    inputSchema: z.strictObject({
      strip: z
        .enum(stripIds)
        .optional()
        .describe(
          "A stretch by id (sandiego, orange-la, grapevine, kern-westside, westside, delta, sacramento, valley, tehama, shasta, siskiyou)",
        ),
      from_mile: z
        .number()
        .min(0)
        .max(800)
        .optional()
        .describe("Start of a mile range (Caltrans odometer)"),
      to_mile: z
        .number()
        .min(0)
        .max(800)
        .optional()
        .describe("End of a mile range"),
      near: z
        .strictObject({
          lat: z.number().min(32).max(42.1).describe("Latitude"),
          lon: z.number().min(-124.5).max(-114).describe("Longitude"),
        })
        .optional()
        .describe(
          "A point on or near I-5; the window starts at the nearest point of the road",
        ),
      direction: z
        .enum(["north", "south"])
        .default("north")
        .describe("Direction of travel from near; north means increasing s"),
      ahead_miles: z
        .number()
        .min(1)
        .max(800)
        .default(50)
        .describe("Window in miles from near in the direction of travel"),
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
      family: z.boolean().default(false).describe("Only family stops"),
      paired: z
        .boolean()
        .default(false)
        .describe("Also list the paired stops in the window"),
      dog_friendly_only: z
        .boolean()
        .default(true)
        .describe("Leave out stops where dogs are not allowed"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(15)
        .describe("Maximum stops to return"),
      offset: z.number().int().min(0).default(0).describe("Stops to skip"),
      response_format: z
        .enum(["markdown", "json"])
        .default("markdown")
        .describe("'markdown' for readable text, 'json' for structured data"),
    }),
    outputSchema: z.looseObject({
      ...Envelope,
      ...OutcomeFields,
      nearest_i5: z
        .looseObject({})
        .optional()
        .describe(
          "With a point too far from I-5: the nearest point on I-5 and how far it is",
        ),
      axis_version: z.string(),
      strips: z.array(
        z.looseObject({
          id: z.string(),
          name: z.string(),
          start_s_m: z.number(),
          end_s_m: z.number(),
          from_mile: z.number(),
          to_mile: z.number(),
          stops: z.number(),
          family_stops: z.number(),
        }),
      ),
      window: z.looseObject({}).nullable(),
      total: z.number(),
      stops: z.array(PlaceItem),
      paired_stops: z.array(z.looseObject({})),
    }),
    annotations: READ_ONLY,
    handler: async (args) => {
      const format = args.response_format;
      const envelope = ctx.citations.envelope(ctx.graph.as_of);
      if (!axis)
        return answer({
          outcome: "unavailable",
          code: "unavailable",
          message:
            'This data snapshot carries no I-5 axis, so the corridor cannot be read; dogpolicies_route_stops with route="i-5" still lists the stops by mile.',
          shape: {
            ...envelope,
            axis_version: "",
            strips: [],
            window: null,
            total: 0,
            stops: [],
            paired_stops: [],
          },
          next: ['dogpolicies_route_stops with route="i-5"'],
          format,
        });
      const today = ctx.today();
      const cal = calibrationOf(axis);
      const stripsOut = axis.strips.map((st) => {
        const inStrip = route.stops.filter((x) => x.strip === st.id);
        return {
          id: st.id,
          name: st.name.replace(/^I-5 · /, ""),
          start_s_m: Math.round(st.startS),
          end_s_m: Math.round(Math.min(st.endS, axis.ca_end_s)),
          from_mile: Math.max(0, Math.round(cal.sToMile(st.startS) * 10) / 10),
          to_mile:
            Math.round(cal.sToMile(Math.min(st.endS, axis.ca_end_s)) * 10) / 10,
          stops: inStrip.length,
          family_stops: inStrip.filter((x) => isFamilyStop(x.place)).length,
        };
      });

      // The window in s.
      let window = null;
      let ahead = args.direction === "north";
      let startS = null;
      if (args.strip) {
        const st = findStrip(axis, args.strip);
        window = {
          kind: "strip",
          strip: st.id,
          name: st.name.replace(/^I-5 · /, ""),
          lo_s: Math.round(st.startS),
          hi_s: Math.round(Math.min(st.endS, axis.ca_end_s)),
        };
        startS = ahead ? window.lo_s : window.hi_s;
      } else if (args.from_mile != null || args.to_mile != null) {
        const a = cal.mileToS(args.from_mile ?? 0);
        const b = cal.mileToS(args.to_mile ?? route.length_miles);
        window = {
          kind: "miles",
          from_mile: args.from_mile ?? 0,
          to_mile: args.to_mile ?? route.length_miles,
          lo_s: Math.round(Math.min(a, b)),
          hi_s: Math.round(Math.max(a, b)),
        };
        ahead = b >= a;
        startS = ahead ? window.lo_s : window.hi_s;
      } else if (args.near) {
        const pos = positionOf(route, args.near);
        if (!pos) {
          // Too far from the road to start a window there: say how far, and
          // which stretch is nearest, so the next call can be right.
          const far = positionOf(route, args.near, { maxOffMiles: 2000 });
          const strip = far ? stripAt(axis, far.s) : null;
          const message = far
            ? `The point is ${far.off_miles} miles from I-5 in California (nearest at mile ${far.mile}, ${strip.name.replace(/^I-5 · /, "")}); a window starts within 25 miles of the road.`
            : "The point is not near I-5 in California.";
          return answer({
            outcome: "bad_input",
            code: "invalid",
            message,
            shape: {
              ...envelope,
              ...(far
                ? {
                    nearest_i5: {
                      mile: far.mile,
                      s: far.s,
                      miles_away: far.off_miles,
                      strip: strip.id,
                    },
                  }
                : {}),
              axis_version: axis.version,
              strips: stripsOut,
              window: null,
              total: 0,
              stops: [],
              paired_stops: [],
            },
            next: [
              ...(far
                ? [
                    `strip="${strip.id}" reads the stretch nearest the point`,
                    `from_mile=${Math.max(0, Math.round(far.mile - 25))}, to_mile=${Math.round(far.mile + 25)} reads 50 miles around it`,
                  ]
                : []),
              "dogpolicies_near with the town answers what is around the point itself",
            ],
            format,
          });
        }
        startS = pos.s;
        const end = ahead
          ? pos.s + args.ahead_miles * MILE_M
          : pos.s - args.ahead_miles * MILE_M;
        window = {
          kind: "ahead",
          start: pos,
          direction: args.direction,
          ahead_miles: args.ahead_miles,
          lo_s: Math.round(Math.min(pos.s, end)),
          hi_s: Math.round(Math.max(pos.s, end)),
          strip: stripAt(axis, pos.s).id,
        };
      }
      if (window) {
        window.from_mile ??= Math.round(cal.sToMile(window.lo_s) * 10) / 10;
        window.to_mile ??= Math.round(cal.sToMile(window.hi_s) * 10) / 10;
      }

      let stops = [];
      let paired = [];
      if (window) {
        stops = route.stops.filter(
          (x) =>
            x.s_m != null &&
            x.s_m >= window.lo_s &&
            x.s_m <= window.hi_s &&
            (window.kind !== "ahead" || x.s_m !== startS) &&
            servesDirection(x, ahead),
        );
        if (args.kinds)
          stops = stops.filter((x) => args.kinds.includes(x.place.type));
        if (args.dog_friendly_only)
          stops = stops.filter((x) => x.place.status !== "no");
        if (args.family) stops = stops.filter((x) => isFamilyStop(x.place));
        stops.sort((a, b) => (ahead ? a.s_m - b.s_m : b.s_m - a.s_m));
        if (args.paired)
          paired = pairedIn(axis, window.lo_s, window.hi_s)
            .map((pr) => pairRow(pr, ctx.graph))
            .sort((a, b) =>
              ahead ? a.exit.s - b.exit.s : b.exit.s - a.exit.s,
            );
      }
      const total = stops.length;
      const page = stops.slice(args.offset, args.offset + args.limit).map((x) =>
        summary(x.place, today, {
          mile: x.mile,
          off_route_miles: x.off_miles,
          on_road: route.short,
          exit: x.place.exit ?? null,
          ...axisFields(x, { startS, ahead }),
        }),
      );
      const data = {
        ...ctx.citations.envelope(ctx.graph.as_of),
        axis_version: axis.version,
        strips: stripsOut,
        window,
        total,
        stops: page,
        paired_stops: paired,
        ...(page.some((s) => s.osm) ? { attribution: OSM_ATTRIBUTION } : {}),
      };
      return result(data, args.response_format, () => {
        const lines = [];
        if (!window) {
          lines.push(
            `# I-5 in California: ${stripsOut.length} stretches on the I-5 axis (version ${axis.version})`,
            "",
          );
          for (const st of stripsOut)
            lines.push(
              `- ${st.name} (\`${st.id}\`): miles ${st.from_mile}–${st.to_mile}, s ${st.start_s_m.toLocaleString("en-US")}–${st.end_s_m.toLocaleString("en-US")} m, ${st.stops} stops, ${st.family_stops} family stops`,
            );
        } else {
          const where =
            window.kind === "strip"
              ? `${window.name} (\`${window.strip}\`)`
              : window.kind === "miles"
                ? `miles ${window.from_mile}–${window.to_mile}`
                : `${args.ahead_miles} miles ${args.direction} of mile ${window.start.mile} (s ${window.start.s.toLocaleString("en-US")} m)`;
          lines.push(
            `# ${total} ${args.family ? "family " : "dog "}stops on I-5, ${where}, heading ${ahead ? "north" : "south"}`,
            "",
            ...(page.length
              ? page.map(
                  (s) =>
                    `${summaryLine(s)}\n  ${s.miles_ahead != null ? `${s.miles_ahead} mi ahead · ` : ""}${s.side === "both" ? "both directions" : s.side === "right" ? "northbound side" : "southbound side"} · ${Math.round(s.elevation_m * 3.28084).toLocaleString("en-US")} ft${s.family_stop ? " · family stop" : ""}${s.hours ? ` · ${s.hours.text}` : ""}`,
                )
              : ["No stops in this window."]),
          );
          if (args.paired)
            lines.push(
              "",
              `## ${paired.length} paired stops`,
              "",
              ...(paired.length ? paired.map(pairLine) : ["(none)"]),
              "",
              "Exit numbers, names and people-stop counts are OpenStreetMap data (ODbL, © OpenStreetMap contributors); restrooms at a people-stop are not verified.",
            );
        }
        lines.push(...ctx.citations.footer(page, { osmLine: OSM_ATTRIBUTION }));
        const text = lines.join("\n");
        return text.length <= LIMITS.resultCharacters
          ? text
          : text.slice(0, LIMITS.resultCharacters - 60) +
              "\n\n(Trimmed; ask for a smaller limit.)";
      });
    },
  };
};
