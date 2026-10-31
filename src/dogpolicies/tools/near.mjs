import * as z from "zod/v4";
import { READ_ONLY } from "../../core/server.mjs";
import { result } from "../../core/result.mjs";
import { LIMITS } from "../../config.mjs";
import {
  PlaceItem,
  Envelope,
  OSM_ATTRIBUTION,
  summary,
  summaryLine,
} from "./common.mjs";
import { resolveScope, scopeSchema } from "./scope.mjs";

export const GROUPS = [
  ["beach", "Beaches"],
  ["park", "Parks"],
  ["trail", "Trails"],
  ["lodging", "Hotels and lodging"],
  ["campground", "Campgrounds and RV parks"],
  ["cabins", "Cabins"],
  ["restaurant", "Places to eat and drink"],
  ["rest_area", "Rest areas"],
  ["stop", "Roadside stops"],
];

export const near = (ctx) => ({
  name: "dogpolicies_near",
  title: "What is near a town",
  since: "0.2.0",
  cache: true,
  description: `Anything for dogs around a town, county or point: everything dog-related nearby, grouped by kind: beaches, parks, trails, hotels, campgrounds, cabins, places to eat and rest areas, each sorted by distance, with the dog rule and citation for each. The one call to make when a user names a place and asks "what can I do with my dog there?".

Takes a town or county name (no coordinates needed) or a point. Use dogpolicies_find_hotels when the question is about a specific dog's weight or budget, dogpolicies_plan_trip for a whole stay, dogpolicies_search_places for one kind with filters.

Examples:
  - "What can my dog do in Carmel?" -> place="Carmel"
  - "Dog beaches and parks around South Lake Tahoe" -> place="South Lake Tahoe", types=["beach","park"]
  - "Anything dog-friendly within 5 miles of here" -> near={lat:36.6, lon:-121.9}, radius_miles=5`,
  inputSchema: z.strictObject({
    ...scopeSchema,
    types: z
      .array(z.enum(GROUPS.map(([t]) => t)))
      .min(1)
      .optional()
      .describe("Kinds to include; all by default"),
    dogs_allowed_only: z
      .boolean()
      .default(true)
      .describe("Leave out places where dogs are not allowed"),
    per_type: z
      .number()
      .int()
      .min(1)
      .max(20)
      .default(5)
      .describe("Nearest results to show per kind"),
    response_format: z
      .enum(["markdown", "json"])
      .default("markdown")
      .describe("'markdown' for readable text, 'json' for structured data"),
  }),
  outputSchema: z.looseObject({
    ...Envelope,
    center: z.looseObject({ lat: z.number(), lon: z.number() }),
    label: z.string(),
    radius_miles: z.number(),
    total: z.number(),
    groups: z.array(
      z.looseObject({
        type: z.string(),
        label: z.string(),
        total: z.number(),
        places: z.array(PlaceItem),
      }),
    ),
  }),
  annotations: READ_ONLY,
  handler: async (args) => {
    const scope = resolveScope(ctx, args);
    if (scope.error) return scope.error;
    const today = ctx.today();
    const wanted = new Set(args.types ?? GROUPS.map(([t]) => t));
    let found = scope.within(ctx.graph.places);
    if (args.dogs_allowed_only)
      found = found.filter((x) => x.place.status !== "no");
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
      ...ctx.citations.envelope(ctx.graph.as_of),
      center: scope.center,
      label: scope.label,
      radius_miles: scope.radius,
      total: found.length,
      groups,
      ...(shown.some((s) => s.osm) ? { attribution: OSM_ATTRIBUTION } : {}),
    };
    return result(data, args.response_format, () => {
      const lines = [
        `# ${found.length} dog-related place${found.length === 1 ? "" : "s"} within ${scope.radius} miles of ${scope.label}`,
      ];
      if (!groups.length)
        lines.push(
          "",
          "No matching places. Try a larger radius or a nearby larger town.",
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
