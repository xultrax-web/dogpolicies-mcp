import * as z from "zod/v4";
import { READ_ONLY } from "../../core/server.mjs";
import { result } from "../../core/result.mjs";
import { nearestOnLine } from "../../core/geo.mjs";
import { LIMITS } from "../../config.mjs";
import {
  Envelope,
  OutcomeFields,
  answer,
  norm,
  resolveTown,
  suggestTowns,
} from "./common.mjs";
import { CONDITIONS_PATH, STALE_MINUTES } from "./i5-conditions.mjs";
import { isoFromEpoch } from "../vendor/closures.mjs";

const num = () => z.coerce.number();

/**
 * The routes the site's conditions loop serves (worker/conditions-core.mjs,
 * CONDITIONS_ROUTES; the site's tests keep the two lists in step), with the
 * number people say for each and the stretch it covers.
 */
export const ROAD_CONDITIONS_ROUTES = {
  "i-80": { number: "80", covers: "San Francisco to the Nevada line" },
  "us-50": {
    number: "50",
    covers: "West Sacramento to the Nevada line at Stateline",
  },
  "i-15": { number: "15", covers: "San Diego to the Nevada line at Primm" },
  "i-5": { number: "5", covers: "the Mexican border to Oregon" },
};
export const QUICKMAP_URL = "https://quickmap.dot.ca.gov/";
export const conditionsPathFor = (id) =>
  id === "i-5" ? CONDITIONS_PATH : `/api/v1/conditions/${id}.json`;

// "I-80 Nevada", "i-80-nevada": the same number in another state. ("I-80 to Reno" is the California part.)
const OUTSIDE = /\b(nevada|nv|utah|arizona|oregon)\b/;

/**
 * "I-80", "80", "US 50", "Highway 50", "Interstate 15", "i-5" -> a route id,
 * or { miss } with why. A highway outside California ("I-80 Nevada",
 * "i-80-nevada") is a miss that names the California route of that number.
 */
export function roadOf(text) {
  const s = norm(text).replace(/[._]/g, " ").replace(/\s+/g, " ").trim();
  if (Object.hasOwn(ROAD_CONDITIONS_ROUTES, s)) return { id: s };
  const digits = s.match(/\d{1,3}/)?.[0] ?? null;
  const id = digits
    ? Object.keys(ROAD_CONDITIONS_ROUTES).find(
        (k) => ROAD_CONDITIONS_ROUTES[k].number === String(Number(digits)),
      )
    : null;
  if (id && OUTSIDE.test(s.replace(/-/g, " ")))
    return { miss: "outside", digits, near: id };
  if (id) return { id };
  return { miss: digits ? "uncovered" : "unread", digits };
}

/** The covered routes, those whose number starts like the asked one first. */
function routeSuggestions(graph, digits, first = null) {
  const ids = Object.keys(ROAD_CONDITIONS_ROUTES);
  const score = (id) =>
    id === first
      ? 0
      : digits && ROAD_CONDITIONS_ROUTES[id].number.startsWith(digits[0])
        ? 1
        : 2;
  return ids
    .filter((id) => graph.routes[id])
    .sort((a, b) => score(a) - score(b))
    .map((id) => ({
      route: id,
      road: graph.routes[id].short,
      covers: ROAD_CONDITIONS_ROUTES[id].covers,
    }));
}

// Words too common in stretch names to tell them apart.
const GENERIC = new Set(
  "the and to of at pass summit valley lake river canyon county city north south east west mount line nevada california state highway interstate route drive road".split(
    " ",
  ),
);
const words = (s) =>
  norm(s)
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w.length >= 3 && !GENERIC.has(w));

/** A named stretch of the route's guide ("Donner Pass" -> "Donner Pass and Truckee", miles 170-204), or null. */
export function findStretch(route, text) {
  const q = norm(text).replace(/\s+/g, " ").trim();
  const all = route?.stretches ?? [];
  if (!q || !all.length) return null;
  const whole = q.length >= 4 && all.find((st) => norm(st.name).includes(q));
  if (whole) return whole;
  const asked = words(q);
  if (!asked.length) return null;
  let best = null;
  for (const st of all) {
    const hits = words(st.name).filter((w) => asked.includes(w)).length;
    if (hits && (!best || hits > best.hits)) best = { st, hits };
  }
  return best?.st ?? null;
}

// North and east mean increasing route miles; south and west, decreasing.
const AHEAD_WORDS = new Set(["northbound", "eastbound"]);
const BACK_WORDS = new Set(["southbound", "westbound"]);
const travelOf = (direction) =>
  direction == null
    ? null
    : ["north", "east"].includes(direction)
      ? "ahead"
      : "back";
const serves = (item, travel) => {
  if (!travel) return true;
  const d = item.direction;
  if (AHEAD_WORDS.has(d)) return travel === "ahead";
  if (BACK_WORDS.has(d)) return travel === "back";
  return true; // "both", or a direction the feed did not give
};
const round1 = (n) => Math.round(n * 10) / 10;
const count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
// A station reading more than this much older than the fetch is not current:
// the district files are sometimes served months behind.
export const READING_CURRENT_HOURS = 2;
const PACIFIC = (() => {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    return null;
  }
})();
/** "2026-11-09T21:14:02", California wall time as Caltrans writes it, to epoch seconds. */
export function pacificEpoch(local) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(
    local ?? "",
  );
  if (!m) return null;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
  for (const offset of [8, 7]) {
    const t = wall + offset * 3_600_000;
    const parts = PACIFIC?.formatToParts(new Date(t)) ?? [];
    const get = (type) => parts.find((p) => p.type === type)?.value;
    if (
      `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}` ===
      local.slice(0, 16)
    )
      return t / 1000;
  }
  return (wall + 8 * 3_600_000) / 1000;
}
/** The reading's age against the fetch, in hours, and whether it is current. */
function readingAge(w, fetchedAt) {
  const at = Number.isFinite(w.recordedEpoch)
    ? w.recordedEpoch
    : pacificEpoch(w.recordedAt);
  const fetched = Date.parse(fetchedAt) / 1000;
  if (!Number.isFinite(at) || !Number.isFinite(fetched))
    return { reading_age_hours: null, current: false };
  const hours = Math.round(((fetched - at) / 3600) * 10) / 10;
  return {
    reading_age_hours: hours,
    current: hours <= READING_CURRENT_HOURS && hours >= -1,
  };
}
const dirText = (d) => (d === "both" ? "both directions" : d);
const milesText = (a, b) => (a === b ? `Mile ${a}` : `Mile ${a}–${b}`);

/**
 * The road conditions tool: what is closed, where chains are required and what
 * the weather stations read on a California highway the site's 15-minute loop
 * follows (I-5, I-80, US-50, I-15), from that route's conditions document. The
 * hosted server reads the document in-process (ctx.roadConditions, or
 * ctx.conditions for I-5); the npm package reads it from the site over the
 * network. When neither can, the answer says so (outcome unavailable) and
 * points at Caltrans QuickMap: that is not an error of this server.
 */
export const roadConditions = (ctx) => {
  const site = () => ctx.graph.site.url.replace(/\/+$/, "");
  return {
    name: "dogpolicies_road_conditions",
    title: "Road conditions now: closures, chains, weather",
    since: "0.5.0",
    cache: false,
    description: `Do I need chains on I-80 to Tahoe right now? Is US-50 open over Echo Summit? Caltrans chain controls, lane and ramp closures, road-weather stations and message-sign text on I-80 (San Francisco to the Nevada line), US-50 (West Sacramento to Stateline), I-15 (San Diego to Primm) and I-5 in California, each at its route mile with the nearest dog stop.
Live state, not rules: Caltrans feed data fetched every 15 minutes (fetched_at in the result), never a verified fact. For the day of a mountain or desert drive: Donner Summit, Echo Summit, Cajon Pass, the Grapevine. It reports conditions, not places to stop: each condition carries only the nearest dog stop. Nevada roads and other highways are not covered.
Inputs: route ("I-80", "80", "US 50", "Highway 50", "I-15", "I-5"); a window as from_mile and to_mile, or town (a town or named stretch on the route: Truckee, Donner Pass, South Lake Tahoe, Placerville, Cajon Pass, Barstow) with direction and ahead_miles; direction alone keeps that direction's closures, signs and chain controls. With no window, the whole route in California.
chain_controls_in_effect is true when a Caltrans chain-control point in the window reports a control (any status but R-0), with Caltrans' own wording; a sign that mentions chains is listed under signs with its text. Each weather station says whether its reading is current (the feeds sometimes carry readings months old; those numbers are left out of the text). A document older than two hours is marked stale; when no document can be read the answer has outcome unavailable and the address of Caltrans QuickMap, the live map.

Examples:
  - "Do I need chains on I-80 to Tahoe right now?" -> route="I-80", direction="east"
  - "Is Highway 50 open over Echo Summit?" -> route="Highway 50", town="Echo Summit"
  - "Closures on I-15 from Barstow to the Nevada line" -> route="I-15", town="Barstow", direction="north", ahead_miles=120`,
    inputSchema: z.strictObject({
      route: z
        .string()
        .min(1)
        .max(60)
        .describe(
          'The highway in California: "I-80", "80", "US 50", "Highway 50", "I-15" or "I-5"',
        ),
      from_mile: num()
        .min(0)
        .max(1000)
        .optional()
        .describe(
          "Start of a mile range on the route (the road-trip guide's miles)",
        ),
      to_mile: num()
        .min(0)
        .max(1000)
        .optional()
        .describe("End of a mile range on the route"),
      town: z
        .string()
        .min(2)
        .max(80)
        .optional()
        .describe(
          'A town or named stretch on the route ("Truckee", "Donner Pass", "South Lake Tahoe", "Cajon Pass", "Barstow")',
        ),
      direction: z
        .enum(["north", "south", "east", "west"])
        .optional()
        .describe(
          "Direction of travel. Keeps that direction's closures, signs and chain controls (and those for both ways); with town, the window runs ahead of it. North and east mean increasing route miles",
        ),
      ahead_miles: num()
        .min(1)
        .max(800)
        .optional()
        .describe(
          "With town: miles from it in the direction of travel (default 50), or on each side of it without a direction (default 25)",
        ),
      response_format: z
        .enum(["markdown", "json"])
        .default("markdown")
        .describe("'markdown' for readable text, 'json' for structured data"),
    }),
    outputSchema: z.looseObject({
      ...Envelope,
      ...OutcomeFields,
      route: z
        .string()
        .nullable()
        .describe(
          "Route id (i-80, us-50, i-15, i-5); null when the route is not covered",
        ),
      road: z.string().nullable().describe('The road as signed, e.g. "I-80"'),
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
      chain_controls_in_effect: z
        .boolean()
        .describe(
          "A Caltrans chain-control point in the window reports a control in effect",
        ),
      chains_in_effect: z
        .boolean()
        .describe(
          "A chain control in effect or a sign that mentions chains, counted the same way as in the I-5 conditions answer",
        ),
      counts: z.looseObject({}),
      closures: z.array(z.looseObject({})),
      chain_controls: z
        .array(z.looseObject({}))
        .describe(
          "The chain-control points in the window with a control in effect",
        ),
      weather: z
        .array(z.looseObject({}))
        .describe(
          "Road-weather stations in the window; current is false when the station's reading is more than two hours older than fetched_at",
        ),
      signs: z.array(z.looseObject({})),
      feeds_failed: z
        .array(z.string())
        .describe("District feeds that did not answer at the last fetch"),
      source: z.looseObject({}),
      live_map: z
        .string()
        .describe("Caltrans QuickMap, the live map of the same feeds"),
    }),
    annotations: READ_ONLY,
    handler: async (args) => {
      const format = args.response_format;
      const envelope = ctx.citations.envelope(ctx.graph.as_of);
      const empty = (extra = {}) => ({
        ...envelope,
        route: null,
        road: null,
        fetched_at: null,
        notice: "",
        window: null,
        chain_controls_in_effect: false,
        chains_in_effect: false,
        counts: {},
        closures: [],
        chain_controls: [],
        weather: [],
        signs: [],
        feeds_failed: [],
        source: {},
        live_map: QUICKMAP_URL,
        ...extra,
      });
      const missText = (title, message, lines = [], next = []) =>
        [
          `# ${title}`,
          "",
          message,
          ...(lines.length ? ["", ...lines] : []),
          ...(next.length
            ? ["", "Try next:", ...next.map((s) => `- ${s}`)]
            : []),
          "",
          ctx.citations.licenseLine,
        ].join("\n");

      // ---- Which road ----
      const asked = roadOf(args.route);
      let id = asked.id ?? null;
      let stretchFromRoute = null;
      if (!id && asked.miss === "unread") {
        // "Donner Pass", "Cajon Pass": the one covered route with a stretch of that name.
        const hits = Object.keys(ROAD_CONDITIONS_ROUTES)
          .map((rid) => ({
            rid,
            st: findStretch(ctx.graph.routes[rid], args.route),
          }))
          .filter((x) => x.st);
        if (hits.length === 1) {
          id = hits[0].rid;
          stretchFromRoute = hits[0].st;
        }
      }
      if (!id || !ctx.graph.routes[id]) {
        const did_you_mean = routeSuggestions(
          ctx.graph,
          asked.digits,
          asked.near,
        );
        const message =
          asked.miss === "outside"
            ? `"${args.route}" is outside California. Road conditions here come from Caltrans' feeds, so they stop at the state line; ${ctx.graph.routes[asked.near]?.short ?? asked.near} in California is covered.`
            : `Live road conditions cover I-80, US-50, I-15 and I-5 in California; "${args.route}" is not one of them. Caltrans QuickMap (${QUICKMAP_URL}) shows every state highway.`;
        const next = [
          ...(asked.near
            ? [`route="${asked.near}" reads the California part`]
            : []),
          "For dog stops along any listed highway, dogpolicies_route_stops",
          `Caltrans QuickMap for any other California highway: ${QUICKMAP_URL}`,
        ];
        return answer({
          outcome: "no_match",
          code: "not_found",
          message,
          shape: empty({ notice: message }),
          did_you_mean,
          next,
          format,
          text: missText(
            "Road not covered",
            message,
            [
              "Covered:",
              ...did_you_mean.map(
                (r) => `- ${r.road} (\`${r.route}\`): ${r.covers}`,
              ),
            ],
            next,
          ),
        });
      }
      const route = ctx.graph.routes[id];
      const road = route.short;
      const length = route.length_miles;
      const conditionsUrl = `${site()}${conditionsPathFor(id)}`;
      const guide = `${site()}/road-trips/${id}/`;
      const base = (extra = {}) =>
        empty({
          route: id,
          road,
          conditions_url: conditionsUrl,
          guide,
          ...extra,
        });

      // ---- The window ----
      const travel = travelOf(args.direction);
      let window = null;
      const clamp = (m) => Math.min(length, Math.max(0, m));
      if (args.from_mile != null || args.to_mile != null) {
        const a = clamp(args.from_mile ?? 0);
        const b = clamp(args.to_mile ?? length);
        window = {
          from_mile: round1(Math.min(a, b)),
          to_mile: round1(Math.max(a, b)),
        };
      } else if (args.town || stretchFromRoute) {
        const text = args.town ?? args.route;
        const stretch = stretchFromRoute ?? findStretch(route, text);
        // With a direction the town is a start; without one, a stretch is the window.
        const place = !stretch || travel ? resolveTown(ctx.graph, text) : null;
        let at = null;
        if (place) {
          const on = nearestOnLine(route.points, place);
          if (on.mile == null || on.offMiles > 25) {
            const message = `${place.name} is ${on.offMiles} miles from ${road} in California (nearest at mile ${on.mile}); conditions are read along the road.`;
            const next = [
              ...(on.mile != null
                ? [
                    `from_mile=${Math.max(0, Math.round(on.mile - 25))}, to_mile=${Math.round(on.mile + 25)} reads the stretch nearest it`,
                  ]
                : []),
              `Leave town out to read all of ${road} in California`,
            ];
            return answer({
              outcome: "bad_input",
              code: "invalid",
              message,
              shape: base({ notice: message }),
              next,
              format,
              text: missText(
                `${place.name} is not on ${road}`,
                message,
                [],
                next,
              ),
            });
          }
          at = { name: place.name, mile: on.mile, off_miles: on.offMiles };
        } else if (!stretch) {
          const did_you_mean = suggestTowns(ctx.graph, text);
          const message = `"${text}" is not a town or named stretch the data knows on ${road}.`;
          const next = [
            `Leave town out to read all of ${road} in California`,
            "from_mile and to_mile read a mile range",
            ...(route.stretches?.length
              ? [
                  `Named stretches: ${route.stretches.map((st) => st.name).join("; ")}`,
                ]
              : []),
          ];
          return answer({
            outcome: "no_match",
            code: "not_found",
            message,
            shape: base({ notice: message }),
            did_you_mean,
            next,
            format,
            text: missText(
              "Town not found",
              message,
              did_you_mean.length
                ? [
                    "Did you mean:",
                    ...did_you_mean.map(
                      (t) => `- ${t.name}${t.state ? `, ${t.state}` : ""}`,
                    ),
                  ]
                : [],
              next,
            ),
          });
        }
        if (at) {
          const ahead = args.ahead_miles ?? (travel ? 50 : 25);
          const [a, b] = !travel
            ? [at.mile - ahead, at.mile + ahead]
            : travel === "ahead"
              ? [at.mile, at.mile + ahead]
              : [at.mile - ahead, at.mile];
          window = {
            from_mile: round1(clamp(a)),
            to_mile: round1(clamp(b)),
            town: at,
            ahead_miles: ahead,
          };
        } else {
          // A start in the direction of travel at the stretch's near end.
          const startMile =
            travel === "back" ? stretch.to_mile : stretch.from_mile;
          const ahead = args.ahead_miles;
          window =
            travel && ahead != null
              ? {
                  from_mile: round1(
                    clamp(travel === "ahead" ? startMile : startMile - ahead),
                  ),
                  to_mile: round1(
                    clamp(travel === "ahead" ? startMile + ahead : startMile),
                  ),
                  stretch,
                  ahead_miles: ahead,
                }
              : {
                  from_mile: round1(clamp(stretch.from_mile)),
                  to_mile: round1(clamp(stretch.to_mile)),
                  stretch,
                };
        }
      }
      if (window && args.direction) window.direction = args.direction;
      const where = window
        ? `${window.stretch ? `${window.stretch.name}, ` : window.town ? `from ${window.town.name}, ` : ""}miles ${window.from_mile}–${window.to_mile}`
        : `all of ${road} in California`;

      // ---- The document ----
      const unavailable = (why) => {
        const message = `${why} The live view, with the same feeds, is Caltrans QuickMap: ${QUICKMAP_URL}`;
        const next = [
          `Send the user to ${QUICKMAP_URL} for live closures, chain controls and weather on ${road}`,
          "Call again in a few minutes",
        ];
        return answer({
          outcome: "unavailable",
          code: "unavailable",
          message,
          shape: base({ notice: why, window }),
          next,
          format,
          text: missText(
            `${road} conditions, ${where}: not available right now`,
            message,
            [],
            next,
          ),
        });
      };
      const load = ctx.roadConditions
        ? () => ctx.roadConditions(id)
        : id === "i-5" && ctx.conditions
          ? ctx.conditions
          : ctx.config.network
            ? async () => {
                const res = await ctx.config.fetch(
                  `${ctx.config.baseUrl}${conditionsPathFor(id)}`,
                  {
                    headers: { Accept: "application/json" },
                    signal: AbortSignal.timeout(
                      LIMITS.fetchTimeoutMs ?? 10_000,
                    ),
                  },
                );
                if (!res.ok)
                  throw new Error(
                    `the conditions document answered HTTP ${res.status}`,
                  );
                const doc = await res.json();
                return doc?.error ? null : doc;
              }
            : null;
      if (!load)
        return unavailable(
          "This server runs without network access, so live conditions cannot be read here.",
        );
      let doc = null;
      let why = null;
      try {
        doc = await load();
        if (doc && doc.route && doc.route !== id) doc = null;
        if (!doc)
          why = `No ${road} conditions document is available yet: the loop that reads Caltrans' feeds has not produced one.`;
      } catch (e) {
        why = `The ${road} conditions document could not be read (${e.message}).`;
      }
      if (!doc) return unavailable(why);

      const ageMin = (Date.now() - Date.parse(doc.fetchedAt)) / 60_000;
      // The hosted loader answers a failed read from the last document it held and
      // says so in `fallback`: a stale reading whatever its age, and the answer names the age.
      const fallback = doc.fallback ?? null;
      const stale =
        Boolean(fallback) ||
        (Number.isFinite(ageMin) && ageMin > STALE_MINUTES);
      const agePhrase = !Number.isFinite(ageMin)
        ? "of unknown age"
        : ageMin < 90
          ? `${Math.max(1, Math.round(ageMin))} minutes old`
          : `${Math.round(ageMin / 60)} hours old`;
      const inWindow = (m) =>
        !window || (m != null && m >= window.from_mile && m <= window.to_mile);
      const closures = (doc.closures ?? []).filter(
        (c) =>
          (!window ||
            (Math.max(c.mileBegin, c.mileEnd) >= window.from_mile &&
              Math.min(c.mileBegin, c.mileEnd) <= window.to_mile)) &&
          serves(c, travel),
      );
      const weather = (doc.weather ?? [])
        .filter((w) => inWindow(w.mile))
        .map((w) => ({ ...w, ...readingAge(w, doc.fetchedAt) }));
      const currentWeather = weather.filter((w) => w.current);
      const signs = (doc.signs ?? []).filter(
        (x) => inWindow(x.mile) && serves(x, travel),
      );
      const points = (doc.chainControls ?? []).filter(
        (x) => inWindow(x.mile) && serves(x, travel),
      );
      const inEffect = points.filter((c) => c.inEffect);
      const chainSigns = signs.filter((s) => s.chains);
      const staleNote = fallback
        ? ` The live read of the conditions document failed just now, so this is the last reading this server held, ${agePhrase}: treat it as history and check ${QUICKMAP_URL}.`
        : stale
          ? ` This reading is ${agePhrase}: the feeds or the loop have been down since, so treat it as history and check ${QUICKMAP_URL}.`
          : "";
      const data = {
        ...envelope,
        route: id,
        road,
        fetched_at: doc.fetchedAt,
        ...(stale ? { stale: true } : {}),
        notice: `${doc.notice ?? ""}${staleNote}`.trim(),
        window,
        chain_controls_in_effect: inEffect.length > 0,
        chains_in_effect: inEffect.length > 0 || chainSigns.length > 0,
        counts: {
          closures: closures.length,
          chain_controls_in_effect: inEffect.length,
          chain_control_points: points.length,
          weather: weather.length,
          weather_current: currentWeather.length,
          signs: signs.length,
        },
        closures,
        chain_controls: inEffect,
        weather,
        signs,
        feeds_failed: doc.errors ?? [],
        source: doc.source ?? {},
        live_map: QUICKMAP_URL,
        conditions_url: conditionsUrl,
        guide,
      };
      return result(data, format, () => {
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
        const near = (x) =>
          x.nearestStop
            ? `; nearest dog stop ${x.nearestStop.name} (${x.nearestStop.milesAway} mi)`
            : "";
        const head = inEffect.length
          ? `CHAIN CONTROLS IN EFFECT at ${inEffect.length} of ${count(points.length, "chain-control point")}`
          : `no chain controls in effect${points.length ? ` (${count(points.length, "chain-control point")})` : ""}`;
        const lines = [
          `# ${road} conditions, ${where}${travel ? `, ${args.direction}bound` : ""}: ${head}; ${count(closures.length, "closure")}, ${count(weather.length, "weather station")}${weather.length && currentWeather.length < weather.length ? ` (${currentWeather.length} with a current reading)` : ""}, ${count(signs.length, "sign")} with a message${stale ? " (STALE READING)" : ""}`,
          "",
          `Fetched ${doc.fetchedAt} from Caltrans' CWWP2 feeds. ${data.notice}`,
          "",
          "## Chain controls",
          ...(inEffect.length
            ? inEffect.map(
                (c) =>
                  `- Mile ${c.mile} (${c.name}, ${dirText(c.direction)}): ${c.status}${c.statusText ? `, "${c.statusText}"` : ""}${c.statusAt ? ` (as of ${c.statusAt})` : ""}${near(c)}`,
              )
            : [
                points.length === 1
                  ? "- None in effect: the one chain-control point in the window reports no control."
                  : points.length
                    ? `- None in effect: all ${points.length} chain-control points in the window report no control.`
                    : "- No chain-control point in the window.",
              ]),
          ...(chainSigns.length
            ? [
                `- ${chainSigns.length} sign${chainSigns.length === 1 ? "" : "s"} in the window mention chains; the text is under Message signs.`,
              ]
            : []),
          "",
          "## Closures",
          ...(closures.length
            ? closures.map(
                (c) =>
                  `- ${milesText(c.mileBegin, c.mileEnd)}, ${dirText(c.direction)}: ${c.type} closure${c.facility ? ` (${c.facility})` : ""}, ${c.work || "work not stated"}, lanes closed ${c.lanesClosed || "?"} of ${c.totalLanes || "?"}, ${c.where}${endText(c)}${near(c)}`,
              )
            : ["- None reported in the window."]),
          "",
          "## Road weather",
          ...(weather.length
            ? weather.map((w) =>
                w.current
                  ? `- Mile ${w.mile} (${w.name}${w.elevationFt ? `, ${w.elevationFt} ft` : ""}): air ${w.airF ?? "?"} °F, surface ${w.surfaceF ?? "?"} °F, wind ${w.windMph ?? "?"} mph${w.gustMph ? ` gusting ${w.gustMph}` : ""}${w.visibilityMi != null ? `, visibility ${w.visibilityMi} mi` : ""}${w.recordedAt ? ` (recorded ${w.recordedAt.replace("T", " ")} Pacific)` : ""}`
                  : `- Mile ${w.mile} (${w.name}${w.elevationFt ? `, ${w.elevationFt} ft` : ""}): no current reading; ${w.recordedAt ? `the station's last reading in the feed is from ${w.recordedAt.replace("T", " ")} Pacific` : "the feed gives no reading time"}, so its numbers are left out.`,
              )
            : ["- No station in the window."]),
          "",
          "## Message signs",
          ...(signs.length
            ? signs.map(
                (s) =>
                  `- Mile ${s.mile} (${s.name}, ${dirText(s.direction)}): "${s.lines.join(" / ")}"`,
              )
            : ["- No sign showing a message in the window."]),
          ...(data.feeds_failed.length
            ? [
                "",
                `Feeds that did not answer at the last fetch: ${data.feeds_failed.join("; ")}.`,
              ]
            : []),
          "",
          `Source: ${doc.source?.publisher ?? "Caltrans"}, ${doc.source?.portal ?? ""}. Conditions of use read ${doc.source?.terms?.checked ?? "?"}. Live map: ${QUICKMAP_URL}. This document: ${conditionsUrl}. Dog stops by mile: ${guide}`,
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
