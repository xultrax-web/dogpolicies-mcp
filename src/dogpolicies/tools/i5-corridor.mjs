import * as z from "zod/v4";
import { READ_ONLY } from "../../core/server.mjs";
import { result } from "../../core/result.mjs";
import { LIMITS } from "../../config.mjs";
import { closedNowOf, closuresFor } from "./conditions-source.mjs";
import { closureLine } from "../vendor/closures.mjs";
import {
  Envelope,
  OSM_ATTRIBUTION,
  OutcomeFields,
  PlaceItem,
  answer,
  formatSchema,
  num,
  summary,
  summaryLine,
} from "./common.mjs";
import {
  DIRECTION_SYNONYMS,
  KINDS,
  KIND_SYNONYMS,
  STRIP_NAMES,
  choice,
  choiceList,
  flag,
  idChoice,
  pageSize,
  pointInput,
} from "./tolerant.mjs";
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
    // Closed rest areas come from a live feed: an answer holds five minutes.
    cacheTtlMs: 5 * 60_000,
    description: `What is on I-5 between here and there for a dog: the next restroom stops with a pet area, the stops on the Grapevine, between Sacramento and Redding?
For the freeway in California only, by one of eleven named stretches (sandiego, orange-la, grapevine, kern-westside, westside, delta, sacramento, valley, tehama, shasta, siskiyou), a mile range, or a window ahead of a point. It covers I-5 only, with no hotel fee arithmetic and no closures or chain controls.
Inputs: strip, or from_mile and to_mile (Caltrans odometer), or near={lat, lon} with direction (north or south) and ahead_miles; family=true keeps stops whose official source states restrooms and a pet area or dog park; paired=true adds exits with places for people nearby (counted from OpenStreetMap, never named, not verified for restrooms) matched to the nearest dog-legal place. With none of these it lists the stretches.
Each stop carries its mile, s in meters from San Ysidro, the side of the road, distance off the freeway, and restrooms, water, pet area and hours as the source states them, with source URL and verified date. A rest area Caltrans reports fully closed right now carries closed_now (Caltrans' reason and end time); it stays in the list and the text names the first open stop instead.

Examples:
  - "What is between the Grapevine and Kettleman?" -> strip="grapevine" and strip="kern-westside"
  - "The next 5 family stops northbound from Stockton" -> near={lat:37.95, lon:-121.29}, direction="north", family=true, limit=5
  - "Every stop between mile 300 and 340" -> from_mile=300, to_mile=340`,
    inputSchema: z.strictObject({
      strip: idChoice(
        stripIds,
        Object.fromEntries(
          (axis?.strips ?? []).map((st) => [
            st.id,
            [st.name, ...(STRIP_NAMES[st.id] ?? [])],
          ]),
        ),
      )
        .optional()
        .describe(
          "A stretch by id (sandiego, orange-la, grapevine, kern-westside, westside, delta, sacramento, valley, tehama, shasta, siskiyou)",
        ),
      from_mile: num()
        .min(0)
        .max(800)
        .optional()
        .describe("Start of a mile range (Caltrans odometer)"),
      to_mile: num().min(0).max(800).optional().describe("End of a mile range"),
      near: z
        .preprocess(
          pointInput,
          z.strictObject({
            lat: num().min(32).max(42.1).describe("Latitude"),
            lon: num().min(-124.5).max(-114).describe("Longitude"),
          }),
        )
        .optional()
        .describe(
          "A point on or near I-5; the window starts at the nearest point of the road",
        ),
      direction: choice(
        ["north", "south"],
        DIRECTION_SYNONYMS,
        [],
        "north",
      ).describe("Direction of travel from near; north means increasing s"),
      ahead_miles: num()
        .min(1)
        .max(800)
        .default(50)
        .describe("Window in miles from near in the direction of travel"),
      kinds: choiceList(KINDS, KIND_SYNONYMS)
        .optional()
        .describe("Kinds of stops to include; all by default"),
      family: flag(false).describe("Only family stops"),
      paired: flag(false).describe("Also list the paired stops in the window"),
      dog_friendly_only: flag(true).describe(
        "Leave out stops where dogs are not allowed",
      ),
      limit: pageSize({ max: 50, fallback: 15 }).describe(
        "Maximum stops to return",
      ),
      offset: num().int().min(0).default(0).describe("Stops to skip"),
      response_format: formatSchema().describe(
        "'markdown' for readable text, 'json' for structured data",
      ),
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
      const pageStops = stops.slice(args.offset, args.offset + args.limit);
      // Rest areas Caltrans reports closed now (none when the feed is unavailable).
      const usable = pageStops.some((x) => x.place.type === "rest_area")
        ? await closuresFor(ctx)
        : null;
      const page = pageStops.map((x) => {
        const closed = closedNowOf(x, usable);
        return summary(x.place, today, {
          mile: x.mile,
          off_route_miles: x.off_miles,
          on_road: route.short,
          exit: x.place.exit ?? null,
          ...axisFields(x, { startS, ahead }),
          ...(closed ? { closed_now: closed } : {}),
        });
      });
      const closedRows = page.filter((s) => s.closed_now);
      const firstOpen = closedRows.length
        ? page.find((s) => !s.closed_now && (s.miles_ahead ?? 0) >= 0)
        : null;
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
        if (closedRows.length)
          lines.push(
            "",
            `Closed now (Caltrans): ${closedRows.map((s) => `${s.name}, ${closureLine(s.closed_now).replace("Closed now: ", "")}`).join("; ")}. They stay in the list; skip them${firstOpen ? `: the first open stop is ${firstOpen.name}${firstOpen.miles_ahead != null ? `, ${firstOpen.miles_ahead} mi ahead` : ""}` : ""}. Live Caltrans data read ${closedRows[0].closed_now.fetched_at}, not a verified rule; check quickmap.dot.ca.gov.`,
          );
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
