import * as z from "zod/v4";
import { READ_ONLY } from "../../core/server.mjs";
import { fail } from "../../core/errors.mjs";
import { result } from "../../core/result.mjs";
import { LIMITS } from "../../config.mjs";
import { Envelope } from "./common.mjs";
import { I5, MILE_M, axisOf, calibrationOf, positionOf } from "../i5.mjs";

export const CONDITIONS_PATH = "/api/v1/conditions/i-5.json";

/**
 * The conditions tool reads the site's conditions document (built by the
 * Worker's 15-minute loop from Caltrans' feeds) and returns the items in a
 * window on the axis. It needs the network; offline it says so.
 */
export const i5Conditions = (ctx) => {
  const route = ctx.graph.routes[I5];
  return {
    name: "dogpolicies_i5_conditions",
    title: "I-5 conditions now",
    since: "0.3.0",
    cache: false,
    description: `Current Caltrans lane closures, road-weather station readings, changeable-message-sign text and chain-control status on I-5 in California, each placed on the I-5 centerline (s meters from San Ysidro and the Caltrans mile) and matched to the nearest DogPolicies dog stop. Conditions come from Caltrans' CWWP2 feeds fetched within the last 15 minutes (fetched_at in the result) and are not verified rules.

The window is a mile range (from_mile, to_mile) or a point with a direction and ahead_miles; with none, the whole of I-5 in California. Needs the network (the document is read from dogpolicies.com); offline the result is an error with code offline.

Examples:
  - "Is there a closure or chains on the Grapevine right now?" -> from_mile=170, to_mile=222
  - "Weather and closures in the next 60 miles northbound from Redding" -> near={lat:40.59, lon:-122.39}, direction="north", ahead_miles=60`,
    inputSchema: z.strictObject({
      from_mile: z
        .number()
        .min(0)
        .max(800)
        .optional()
        .describe("Start of a mile range"),
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
        .describe("A point on or near I-5"),
      direction: z
        .enum(["north", "south"])
        .default("north")
        .describe("Direction of travel from near"),
      ahead_miles: z
        .number()
        .min(1)
        .max(800)
        .default(50)
        .describe("Window in miles from near"),
      response_format: z
        .enum(["markdown", "json"])
        .default("markdown")
        .describe("'markdown' for readable text, 'json' for structured data"),
    }),
    outputSchema: z.looseObject({
      ...Envelope,
      fetched_at: z.string(),
      notice: z.string(),
      window: z.looseObject({}).nullable(),
      chains_in_effect: z.boolean(),
      closures: z.array(z.looseObject({})),
      weather: z.array(z.looseObject({})),
      signs: z.array(z.looseObject({})),
      chain_controls: z.array(z.looseObject({})),
      source: z.looseObject({}),
    }),
    annotations: READ_ONLY,
    handler: async (args) => {
      const axis = axisOf(route);
      if (!axis)
        return fail("unavailable", "This data snapshot carries no I-5 axis.");
      if (!ctx.config.network)
        return fail(
          "offline",
          "Conditions need the network: the server is offline (DOGPOLICIES_OFFLINE=1 or no base URL), so no conditions can be read.",
        );
      const cal = calibrationOf(axis);
      let window = null;
      if (args.from_mile != null || args.to_mile != null) {
        const a = cal.mileToS(args.from_mile ?? 0);
        const b = cal.mileToS(args.to_mile ?? route.length_miles);
        window = {
          from_mile: args.from_mile ?? 0,
          to_mile: args.to_mile ?? route.length_miles,
          lo_s: Math.round(Math.min(a, b)),
          hi_s: Math.round(Math.max(a, b)),
        };
      } else if (args.near) {
        const pos = positionOf(route, args.near);
        if (!pos)
          return fail(
            "invalid",
            "The point is more than 25 miles from I-5 in California.",
          );
        const end =
          args.direction === "north"
            ? pos.s + args.ahead_miles * MILE_M
            : pos.s - args.ahead_miles * MILE_M;
        window = {
          start: pos,
          direction: args.direction,
          ahead_miles: args.ahead_miles,
          lo_s: Math.round(Math.min(pos.s, end)),
          hi_s: Math.round(Math.max(pos.s, end)),
        };
        window.from_mile = Math.round(cal.sToMile(window.lo_s) * 10) / 10;
        window.to_mile = Math.round(cal.sToMile(window.hi_s) * 10) / 10;
      }
      let doc;
      try {
        const res = await ctx.config.fetch(
          `${ctx.config.baseUrl}${CONDITIONS_PATH}`,
          {
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(LIMITS.fetchTimeoutMs ?? 10_000),
          },
        );
        if (!res.ok)
          return fail(
            "unavailable",
            `The conditions document answered HTTP ${res.status}; it is rebuilt every 15 minutes.`,
          );
        doc = await res.json();
      } catch (e) {
        return fail(
          "unavailable",
          `The conditions document could not be read: ${e.message}`,
        );
      }
      const inWindow = (s) => !window || (s >= window.lo_s && s <= window.hi_s);
      const closures = (doc.closures ?? []).filter(
        (c) => !window || (c.sEnd >= window.lo_s && c.sBegin <= window.hi_s),
      );
      const weather = (doc.weather ?? []).filter((w) => inWindow(w.s));
      const signs = (doc.signs ?? []).filter((x) => inWindow(x.s));
      const chainControls = (doc.chainControls ?? []).filter((x) =>
        inWindow(x.s),
      );
      const data = {
        ...ctx.citations.envelope(ctx.graph.as_of),
        fetched_at: doc.fetchedAt,
        notice: doc.notice,
        window,
        chains_in_effect:
          chainControls.some((c) => c.inEffect) || signs.some((s) => s.chains),
        closures,
        weather,
        signs,
        chain_controls: chainControls,
        source: doc.source,
      };
      return result(data, args.response_format, () => {
        const where = window
          ? `miles ${window.from_mile}–${window.to_mile}`
          : "all of I-5 in California";
        const when = (e) =>
          e
            ? new Date(e * 1000).toISOString().slice(0, 16).replace("T", " ") +
              " UTC"
            : null;
        const lines = [
          `# I-5 conditions, ${where}: ${closures.length} closures, ${weather.length} weather stations, ${signs.length} signs with a message, ${chainControls.length} chain-control points${data.chains_in_effect ? "; CHAIN CONTROLS IN EFFECT" : ""}`,
          "",
          `Fetched ${doc.fetchedAt} from Caltrans' CWWP2 feeds. ${doc.notice}`,
          "",
          "## Closures",
          ...(closures.length
            ? closures.map(
                (c) =>
                  `- Mile ${c.mileBegin}–${c.mileEnd} (s ${c.sBegin.toLocaleString("en-US")}–${c.sEnd.toLocaleString("en-US")} m), ${c.direction}: ${c.type} closure, ${c.work || "work not stated"}, lanes closed ${c.lanesClosed || "?"} of ${c.totalLanes || "?"}, ${c.where}${c.endEpoch ? `, until ${when(c.endEpoch)}` : c.indefinite ? ", end not set" : ""}; nearest dog stop ${c.nearestStop?.name ?? "none"} (${c.nearestStop?.milesAway ?? "?"} mi)`,
              )
            : ["- None reported in the window."]),
          "",
          "## Road weather",
          ...(weather.length
            ? weather.map(
                (w) =>
                  `- Mile ${w.mile} (${w.name}${w.elevationFt ? `, ${w.elevationFt} ft` : ""}): air ${w.airF ?? "?"} °F, surface ${w.surfaceF ?? "?"} °F, wind ${w.windMph ?? "?"} mph${w.gustMph ? ` gusting ${w.gustMph}` : ""}${w.visibilityMi != null ? `, visibility ${w.visibilityMi} mi` : ""}; nearest dog stop ${w.nearestStop?.name ?? "none"} (${w.nearestStop?.milesAway ?? "?"} mi)`,
              )
            : ["- No station in the window."]),
          "",
          "## Message signs",
          ...(signs.length
            ? signs.map(
                (s) =>
                  `- Mile ${s.mile} (${s.name}, ${s.direction}): "${s.lines.join(" / ")}"`,
              )
            : ["- No sign showing a message in the window."]),
          "",
          "## Chain controls",
          ...(chainControls.length
            ? chainControls.map(
                (c) =>
                  `- Mile ${c.mile} (${c.name}, ${c.direction}): ${c.statusText ?? c.status}${c.statusAt ? ` (as of ${c.statusAt})` : ""}`,
              )
            : ["- No chain-control point in the window."]),
          "",
          `Source: ${doc.source?.publisher ?? "Caltrans"}, ${doc.source?.portal ?? ""}. Conditions of use read ${doc.source?.terms?.checked ?? "?"}.`,
          ctx.citations.line(ctx.graph.as_of),
        ];
        const text = lines.join("\n");
        return text.length <= LIMITS.resultCharacters
          ? text
          : text.slice(0, LIMITS.resultCharacters - 60) +
              "\n\n(Trimmed; narrow the window.)";
      });
    },
  };
};
