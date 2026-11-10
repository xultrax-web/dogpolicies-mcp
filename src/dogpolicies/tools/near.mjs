import * as z from "zod/v4";
import { READ_ONLY } from "../../core/server.mjs";
import { result } from "../../core/result.mjs";
import { LIMITS } from "../../config.mjs";
import {
  PlaceItem,
  Envelope,
  OSM_ATTRIBUTION,
  OutcomeFields,
  answer,
  nearestTo,
  nearestTowns,
  noMatchText,
  summary,
  formatSchema,
  summaryLine,
} from "./common.mjs";
import { resolveScope, scopeAnswer, scopeSchema } from "./scope.mjs";
import { KIND_SYNONYMS, choiceList, flag } from "./tolerant.mjs";

export const GROUPS = [
  ["beach", "Beaches"],
  ["park", "Parks"],
  ["trail", "Trails"],
  ["lodging", "Hotels and lodging"],
  ["campground", "Campgrounds and RV parks"],
  ["cabins", "Cabins"],
  ["restaurant", "Places to eat and drink"],
  ["rest_area", "Rest areas"],
  ["stop", "Roadside stops and airports"],
];

// When nothing sits inside the radius asked for, the search widens to these
// before giving up; the answer says which radius it used.
const WIDER = [30, 60, 100];
const num = () => z.coerce.number();

export const near = (ctx) => ({
  name: "dogpolicies_near",
  title: "What is near a town",
  since: "0.2.0",
  cache: true,
  description: `What can my dog do in or around this town, neighborhood or region: beaches, parks, trails, hotels, campgrounds, cabins, patios and rest areas, nearest first?
Answers "dog-friendly things in X" questions, grouped by kind. It does not check hotels against a dog's weight or a fee budget.
Input: place as people say it: a city, county, neighborhood or alias ("Van Nuys", "Koreatown", "Venice Beach", "the Mission", "DTLA"), an area or region ("Lake Tahoe", "East Bay", "Central Valley"), or near={lat, lon}. Small spelling slips ("Montery") are corrected and labeled. If nothing is inside the radius it widens to 30, 60, then 100 miles and says so.
Each result carries the dog rule, verified date and source URL. An unknown name comes back as an answer with did_you_mean, the nearest towns and next (a larger town or county that is covered).

Examples:
  - "What can my dog do in Carmel?" -> place="Carmel"
  - "Dog beaches and parks around South Lake Tahoe" -> place="South Lake Tahoe", types=["beach","park"]
  - "Anything dog-friendly in Van Nuys?" -> place="Van Nuys"
  - "Anything dog-friendly within 5 miles of here" -> near={lat:36.6, lon:-121.9}, radius_miles=5`,
  inputSchema: z.strictObject({
    ...scopeSchema,
    types: choiceList(
      GROUPS.map(([t]) => t),
      KIND_SYNONYMS,
    )
      .optional()
      .describe("Kinds to include; all by default"),
    dogs_allowed_only: flag(true).describe(
      "Leave out places where dogs are not allowed",
    ),
    per_type: num()
      .int()
      .min(1)
      .max(20)
      .default(5)
      .describe("Nearest results to show per kind"),
    response_format: formatSchema().describe(
      "'markdown' for readable text, 'json' for structured data",
    ),
  }),
  outputSchema: z.looseObject({
    ...Envelope,
    ...OutcomeFields,
    center: z
      .looseObject({ lat: z.number(), lon: z.number() })
      .nullable()
      .describe("The point searched around; null when the place was not found"),
    label: z.string(),
    radius_miles: z.number(),
    radius_widened_from: z
      .number()
      .optional()
      .describe(
        "Set when the radius asked for held nothing and the search widened",
      ),
    total: z.number(),
    groups: z.array(
      z.looseObject({
        type: z.string(),
        label: z.string(),
        total: z.number(),
        places: z.array(PlaceItem),
      }),
    ),
    nearest: z.array(PlaceItem).optional(),
  }),
  annotations: READ_ONLY,
  handler: async (args) => {
    const scope = resolveScope(ctx, args);
    const format = args.response_format;
    if (scope.noMatch)
      return scopeAnswer(ctx, scope.noMatch, {
        format,
        placesOnly: true,
        shape: {
          center: null,
          label: args.place ?? "",
          radius_miles: args.radius_miles ?? 15,
          total: 0,
          groups: [],
        },
      });
    const today = ctx.today();
    const wanted = new Set(args.types ?? GROUPS.map(([t]) => t));
    const keep = (p) =>
      wanted.has(p.type) && (!args.dogs_allowed_only || p.status !== "no");
    let radius = scope.radius;
    let widenedFrom = null;
    let found = scope.within(ctx.graph.places).filter((x) => keep(x.place));
    if (!found.length && !scope.isArea) {
      for (const r of WIDER) {
        if (r <= radius) continue;
        const wider = scope
          .within(ctx.graph.places, r)
          .filter((x) => keep(x.place));
        if (wider.length) {
          widenedFrom = radius;
          radius = r;
          found = wider;
          break;
        }
      }
    }
    const envelope = ctx.citations.envelope(ctx.graph.as_of);
    if (!found.length) {
      // Nothing of the kinds asked for within 100 miles: the nearest records
      // anyway, with their distance, and the nearest towns that have places.
      const nearest = nearestTo(ctx.graph, scope.center, 5, keep).map((x) =>
        summary(x.place, today, { distance_miles: x.distance }),
      );
      const towns = nearestTowns(ctx.graph, scope.center);
      const outside = (nearest[0]?.distance_miles ?? 0) > 150;
      const message = outside
        ? `Nothing in the data within 100 miles of ${scope.label}: the nearest record is ${nearest[0].distance_miles} miles away, so this point is outside the data's coverage of California and Nevada.`
        : `Nothing of the kinds asked for within 100 miles of ${scope.label}${args.types ? " (" + args.types.join(", ") + ")" : ""}.`;
      const next = [
        ...(args.types ? ["Call again without types to see every kind"] : []),
        ...(args.dogs_allowed_only === false
          ? []
          : [
              "dogs_allowed_only=false also lists places that do not allow dogs",
            ]),
        ...towns
          .slice(0, 1)
          .map(
            (t) =>
              `place="${t.name}, ${t.state}" is the nearest town with records (${t.distance_miles} mi)`,
          ),
      ];
      return answer({
        outcome: "no_match",
        code: "not_found",
        message,
        shape: {
          ...envelope,
          center: scope.center,
          label: scope.label,
          radius_miles: radius,
          ...(widenedFrom != null ? { radius_widened_from: widenedFrom } : {}),
          total: 0,
          groups: [],
        },
        did_you_mean: towns,
        nearest,
        next,
        format,
        text: noMatchText(ctx, {
          title: `Nothing within 100 miles of ${scope.label}`,
          message,
          did_you_mean: towns,
          nearest,
          next,
        }),
      });
    }
    const groups = GROUPS.filter(([t]) => wanted.has(t))
      .map(([type, label]) => {
        const all = found.filter((x) => x.place.type === type);
        return {
          type,
          label,
          total: all.length,
          places: all
            .slice(0, args.per_type)
            .map((x) =>
              summary(x.place, today, { distance_miles: x.distance }),
            ),
        };
      })
      .filter((g) => g.total > 0);
    const shown = groups.flatMap((g) => g.places);
    const data = {
      ...envelope,
      center: scope.center,
      label: scope.label,
      radius_miles: radius,
      ...(widenedFrom != null ? { radius_widened_from: widenedFrom } : {}),
      total: found.length,
      groups,
      ...(shown.some((s) => s.osm) ? { attribution: OSM_ATTRIBUTION } : {}),
    };
    return result(data, format, () => {
      const lines = [
        `# ${found.length} dog-related place${found.length === 1 ? "" : "s"} within ${radius} miles of ${scope.label}`,
      ];
      if (widenedFrom != null)
        lines.push(
          "",
          `Nothing sat within ${widenedFrom} miles, so the search widened to ${radius}.`,
        );
      for (const g of groups) {
        lines.push(
          "",
          `## ${g.label} (${g.total}${g.total > g.places.length ? `, nearest ${g.places.length} shown` : ""})`,
          "",
        );
        lines.push(...g.places.map(summaryLine));
      }
      lines.push(...ctx.citations.footer(shown, { osmLine: OSM_ATTRIBUTION }));
      const text = lines.join("\n");
      return text.length <= LIMITS.resultCharacters
        ? text
        : text.slice(0, LIMITS.resultCharacters - 80) +
            "\n\n(Trimmed; ask for fewer kinds or a smaller per_type.)";
    });
  },
});
