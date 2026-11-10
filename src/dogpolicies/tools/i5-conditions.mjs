import * as z from "zod/v4";
import { READ_ONLY } from "../../core/server.mjs";
import { result } from "../../core/result.mjs";
import { LIMITS } from "../../config.mjs";
import { Envelope, OutcomeFields, answer, formatSchema } from "./common.mjs";
import { DIRECTION_SYNONYMS, choice, pointInput } from "./tolerant.mjs";
import { I5, MILE_M, axisOf, calibrationOf, positionOf } from "../i5.mjs";

import { CONDITIONS_PATH, conditionsSource } from "./conditions-source.mjs";
import { isoFromEpoch } from "../vendor/closures.mjs";

export { CONDITIONS_PATH };
// A document older than this is served with stale: true and a note; the loop
// rebuilds it every 15 minutes, so two hours means the feeds or the loop are down.
export const STALE_MINUTES = 120;
const num = () => z.coerce.number();

/**
 * The conditions tool reads the I-5 conditions document (built by the site's
 * 15-minute loop from Caltrans' feeds) and returns the items in a window on
 * the axis. The hosted server reads it in-process (ctx.conditions); the npm
 * package reads it from the site over the network. When neither can, the
 * answer says so (outcome unavailable) and points at the live page: that is
 * not an error of this server.
 */
export const i5Conditions = (ctx) => {
  const route = ctx.graph.routes[I5];
  const livePage = () => `${ctx.graph.site.url}/road-trips/i-5/`;
  return {
    name: "dogpolicies_i5_conditions",
    title: "I-5 conditions now",
    since: "0.3.0",
    cache: false,
    description: `Is I-5 open right now: lane closures, chain controls, road weather and sign messages on the freeway in California, and the nearest dog stop to each?
Live state, not rules: Caltrans feeds fetched within the last 15 minutes (fetched_at in the result), not verified rules. Covers the Grapevine and every other stretch of I-5 in California. Other highways are not covered.
Inputs: from_mile and to_mile, or near={lat, lon} with direction and ahead_miles; with none, all of I-5 in California.
Each condition is placed on the I-5 centerline (mile, s meters from San Ysidro) and matched to the nearest dog stop. If the feeds cannot be read the answer has outcome unavailable and the address of the live Caltrans page. A result older than two hours is marked stale.

Examples:
  - "Is there a closure or chains on the Grapevine right now?" -> from_mile=170, to_mile=222
  - "Weather and closures in the next 60 miles northbound from Redding" -> near={lat:40.59, lon:-122.39}, direction="north", ahead_miles=60`,
    inputSchema: z.strictObject({
      from_mile: num()
        .min(0)
        .max(800)
        .optional()
        .describe("Start of a mile range"),
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
        .describe("A point on or near I-5"),
      direction: choice(
        ["north", "south"],
        DIRECTION_SYNONYMS,
        [],
        "north",
      ).describe("Direction of travel from near"),
      ahead_miles: num()
        .min(1)
        .max(800)
        .default(50)
        .describe("Window in miles from near"),
      response_format: formatSchema().describe(
        "'markdown' for readable text, 'json' for structured data",
      ),
    }),
    outputSchema: z.looseObject({
      ...Envelope,
      ...OutcomeFields,
      fetched_at: z
        .string()
        .nullable()
        .describe(
          "When the loop fetched the feeds; null when no document could be read",
        ),
      stale: z
        .boolean()
        .optional()
        .describe("True when the document is older than two hours"),
      notice: z.string(),
      window: z.looseObject({}).nullable(),
      chains_in_effect: z.boolean(),
      closures: z.array(z.looseObject({})),
      weather: z.array(z.looseObject({})),
      signs: z.array(z.looseObject({})),
      chain_controls: z.array(z.looseObject({})),
      source: z.looseObject({}),
      nearest_i5: z
        .looseObject({})
        .optional()
        .describe(
          "With a point too far from I-5: the nearest point on I-5 and how far it is",
        ),
    }),
    annotations: READ_ONLY,
    handler: async (args) => {
      const format = args.response_format;
      const envelope = ctx.citations.envelope(ctx.graph.as_of);
      const empty = (window = null) => ({
        ...envelope,
        fetched_at: null,
        notice: "",
        window,
        chains_in_effect: false,
        closures: [],
        weather: [],
        signs: [],
        chain_controls: [],
        source: {},
      });
      const unavailable = (why, next = []) =>
        answer({
          outcome: "unavailable",
          code: "unavailable",
          message: `${why} The live view, with the same feeds, is ${livePage()}.`,
          shape: { ...empty(), notice: why },
          next: [
            `Send the user to ${livePage()} for live closures, weather and chain controls`,
            "Call again in a few minutes",
            ...next,
          ],
          format,
        });
      const axis = axisOf(route);
      if (!axis)
        return unavailable(
          "This data snapshot carries no I-5 axis, so conditions cannot be placed on it.",
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
        if (!pos) {
          // Too far from the road: say how far and where the nearest stretch is.
          const far = positionOf(route, args.near, { maxOffMiles: 2000 });
          const message = far
            ? `The point is ${far.off_miles} miles from I-5 in California (nearest at mile ${far.mile}); conditions are read within 25 miles of the road.`
            : "The point is not near I-5 in California.";
          return answer({
            outcome: "bad_input",
            code: "invalid",
            message,
            shape: {
              ...empty(),
              notice: message,
              ...(far
                ? {
                    nearest_i5: {
                      mile: far.mile,
                      s: far.s,
                      miles_away: far.off_miles,
                    },
                  }
                : {}),
            },
            next: [
              ...(far
                ? [
                    `from_mile=${Math.max(0, Math.round(far.mile - 25))}, to_mile=${Math.round(far.mile + 25)} reads the stretch nearest the point`,
                  ]
                : []),
              "Leave near out to read all of I-5 in California",
            ],
            format,
          });
        }
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
      // The document: in-process on the hosted server, over the network for the package.
      const load = conditionsSource(ctx);
      if (!load)
        return unavailable(
          "This server runs without network access, so live conditions cannot be read here.",
        );
      let doc = null;
      let why = null;
      try {
        doc = await load();
        if (!doc)
          why =
            "No conditions document is available yet: the loop that reads Caltrans' feeds has not produced one.";
      } catch (e) {
        why = `The conditions document could not be read (${e.message}).`;
      }
      if (!doc) return unavailable(why);
      const ageMin = (Date.now() - Date.parse(doc.fetchedAt)) / 60_000;
      // The hosted loader (worker/mcp-engine.mjs) answers a failed read from the last
      // document it held and says so in `fallback`: that is a stale reading whatever
      // its age, and the answer names the age.
      const fallback = doc.fallback ?? null;
      const stale =
        Boolean(fallback) ||
        (Number.isFinite(ageMin) && ageMin > STALE_MINUTES);
      const agePhrase = !Number.isFinite(ageMin)
        ? "of unknown age"
        : ageMin < 90
          ? `${Math.max(1, Math.round(ageMin))} minutes old`
          : `${Math.round(ageMin / 60)} hours old`;
      const inWindow = (s) => !window || (s >= window.lo_s && s <= window.hi_s);
      const closures = (doc.closures ?? []).filter(
        (c) => !window || (c.sEnd >= window.lo_s && c.sBegin <= window.hi_s),
      );
      const weather = (doc.weather ?? []).filter((w) => inWindow(w.s));
      const signs = (doc.signs ?? []).filter((x) => inWindow(x.s));
      const chainControls = (doc.chainControls ?? []).filter((x) =>
        inWindow(x.s),
      );
      const staleNote = fallback
        ? ` The live read of the conditions document failed just now, so this is the last reading this server held, ${agePhrase}: treat it as history and check ${livePage()}.`
        : stale
          ? ` This reading is ${agePhrase}: the feeds or the loop have been down since, so treat it as history and check ${livePage()}.`
          : "";
      const data = {
        ...envelope,
        fetched_at: doc.fetchedAt,
        ...(stale ? { stale: true } : {}),
        notice: `${doc.notice ?? ""}${staleNote}`.trim(),
        window,
        chains_in_effect:
          chainControls.some((c) => c.inEffect) || signs.some((s) => s.chains),
        closures,
        weather,
        signs,
        chain_controls: chainControls,
        source: doc.source ?? {},
      };
      return result(data, format, () => {
        const where = window
          ? `miles ${window.from_mile}–${window.to_mile}`
          : "all of I-5 in California";
        // null for no end and for an end no Date can hold (a garbage or wrong-unit epoch).
        const when = (e) => {
          const iso = e ? isoFromEpoch(e) : null;
          return iso ? `${iso.slice(0, 16).replace("T", " ")} UTC` : null;
        };
        const endText = (c) => {
          const until = when(c.endEpoch);
          return until
            ? `, until ${until}`
            : c.endEpoch || c.indefinite
              ? ", end not set"
              : "";
        };
        const lines = [
          `# I-5 conditions, ${where}: ${closures.length} closures, ${weather.length} weather stations, ${signs.length} signs with a message, ${chainControls.length} chain-control points${data.chains_in_effect ? "; CHAIN CONTROLS IN EFFECT" : ""}${stale ? " (STALE READING)" : ""}`,
          "",
          `Fetched ${doc.fetchedAt} from Caltrans' CWWP2 feeds. ${data.notice}`,
          "",
          "## Closures",
          ...(closures.length
            ? closures.map(
                (c) =>
                  `- Mile ${c.mileBegin}–${c.mileEnd} (s ${c.sBegin.toLocaleString("en-US")}–${c.sEnd.toLocaleString("en-US")} m), ${c.direction}: ${c.type} closure, ${c.work || "work not stated"}, lanes closed ${c.lanesClosed || "?"} of ${c.totalLanes || "?"}, ${c.where}${endText(c)}; nearest dog stop ${c.nearestStop?.name ?? "none"} (${c.nearestStop?.milesAway ?? "?"} mi)`,
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
          `Source: ${doc.source?.publisher ?? "Caltrans"}, ${doc.source?.portal ?? ""}. Conditions of use read ${doc.source?.terms?.checked ?? "?"}. Live page: ${livePage()}`,
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
