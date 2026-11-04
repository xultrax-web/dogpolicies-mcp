import * as z from "zod/v4";
import { READ_ONLY } from "../../core/server.mjs";
import {
  ListOutput,
  OFF_LEASH,
  filterByLocation,
  listResponse,
  locationSchema,
  matchesText,
  pageSchema,
  summary,
} from "./common.mjs";

export const searchPlaces = (ctx) => ({
  name: "dogpolicies_search_places",
  title: "Search places",
  since: "0.1.0",
  cache: true,
  description: `Search parks, beaches, trails, hotels, campgrounds and cabin resorts in California and Nevada by name, location and dog rules.

Returns one page of places with a one-line answer ("Yes, on a leash no longer than 6 feet."), status (yes, yes_restricted, no, varies), verification date and page URL. Each result includes the place id.

Examples:
  - "Off-leash beaches near San Diego" -> type="beach", off_leash=true, near={lat:32.72, lon:-117.16}
  - "Can I bring my dog to Point Lobos?" -> query="Point Lobos"
  - "State parks in Marin County that allow dogs" -> type="park", county="Marin", dogs_allowed=true
  - "Lake Tahoe beaches in Nevada that allow dogs" -> type="beach", state="NV", dogs_allowed=true
  - "Off-leash dog parks in Las Vegas" -> type="park", off_leash=true, county="Clark", state="NV"
  - "RV parks in Fresno County that take dogs" -> type="campground", county="Fresno", dogs_allowed=true
  - "Dog-friendly cabins in June Lake" -> type="cabins", query="June Lake", dogs_allowed=true
  - "Restaurants with a dog-friendly patio in Alameda" -> type="restaurant", query="Alameda"`,
  inputSchema: z.strictObject({
    query: z
      .string()
      .min(2)
      .max(100)
      .optional()
      .describe("Words to match in the name, city, county or brand"),
    type: z
      .enum([
        "lodging",
        "campground",
        "cabins",
        "beach",
        "park",
        "trail",
        "restaurant",
      ])
      .optional()
      .describe(
        "Kind of place; campground covers campgrounds and RV parks (some also rent cabins), cabins covers cabin resorts with no campground, restaurant covers restaurants, cafes, bars, breweries and tasting rooms (dogs on the patio, by the owner's published policy)",
      ),
    dogs_allowed: z
      .boolean()
      .optional()
      .describe(
        "true: only places that allow dogs somewhere; false: only places that do not",
      ),
    off_leash: z
      .boolean()
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
    let items = ctx.graph.places.filter((p) => matchesText(p, query));
    if (type) items = items.filter((p) => p.type === type);
    if (dogs_allowed === true)
      items = items.filter((p) => ["yes", "yes_restricted"].includes(p.status));
    if (dogs_allowed === false) items = items.filter((p) => p.status === "no");
    if (off_leash)
      items = items.filter((p) => OFF_LEASH.has(p.facts.leash?.value));
    const located = filterByLocation(items, loc);
    const page = located
      .slice(offset, offset + limit)
      .map(({ place, distance }) =>
        summary(
          place,
          today,
          distance != null ? { distance_miles: distance } : {},
        ),
      );
    return listResponse(ctx, {
      format: response_format,
      total: located.length,
      offset,
      items: page,
      key: "places",
      header: `# ${located.length} place${located.length === 1 ? "" : "s"} found`,
    });
  },
});
