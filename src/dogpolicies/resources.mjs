// Resources: the same records as the tools, addressable by URI so a client
// can attach them to a conversation without a tool call, and templates with
// completion so a person can type a place id or a brand and get the record.
//
//   dogpolicies://about                 what this server is and how to cite it
//   dogpolicies://status                data version, origin, counts, call stats
//   dogpolicies://answers               every answered question
//   dogpolicies://place/{id}            one place, markdown (same text as the tool)
//   dogpolicies://brand/{id}            one brand policy
//   dogpolicies://answer/{slug}         one answered question's places
//   dogpolicies://route/{id}            one highway's dog stops
//   dogpolicies://corridor/i-5          the I-5 corridor: strips and stops by s

import { BRAND, PACKAGE_NAME, PACKAGE_VERSION } from "../config.mjs";
import { tools } from "./tools/index.mjs";

const TEXT = "text/markdown";
const JSON_TYPE = "application/json";

/** The markdown a tool would return for these arguments, run in-process. */
async function viaTool(ctx, name, args) {
  const def = tools.map((make) => make(ctx)).find((t) => t.name === name);
  const parsed = def.inputSchema.parse(args);
  const r = await def.handler(parsed);
  return r;
}

/** A resource exists only when the tool found the record: a no-match answer is "not found" here. */
const found = (r) =>
  r.isError ||
  r.structuredContent?.outcome === "no_match" ||
  r.structuredContent?.outcome === "bad_input"
    ? null
    : { text: r.content[0].text };

const rank = (candidates, value) => {
  const v = (value ?? "").toLowerCase();
  return candidates.filter((c) => c.toLowerCase().includes(v)).slice(0, 50);
};

export const resources = (ctx) => [
  {
    name: "about",
    uri: "dogpolicies://about",
    title: "About this server",
    description:
      "What the data is, how to cite it, the license and the tool list",
    mimeType: TEXT,
    cacheHint: { ttlMs: 3_600_000, cacheScope: "public" },
    read: () => ({
      text: [
        `# ${BRAND.name} MCP server ${PACKAGE_VERSION} (${PACKAGE_NAME})`,
        "",
        `${ctx.graph.places.length} places, ${ctx.graph.brands.length} hotel brands, ${ctx.graph.answers.length} answered questions, ${ctx.graph.routeIds.length} highways in ${ctx.graph.site.coverage ?? "California and Nevada"}. Data of ${ctx.graph.as_of}.`,
        "",
        "Every fact comes from an official source with the date it was checked. Every tool result starts with a citation sentence and ends with the license line. Repeat the citation, or at least the record URL and date.",
        "",
        `Attribution: ${ctx.citations.attribution.attribution_text}. ${ctx.citations.attribution.attribution_url}`,
        "",
        "## Tools",
        "",
        ...tools.map((make) => make(ctx)).map((t) => `- ${t.name}: ${t.title}`),
        "",
        "## Resources",
        "",
        "- dogpolicies://place/{id}, dogpolicies://brand/{id}, dogpolicies://answer/{slug}, dogpolicies://route/{id}, dogpolicies://area/{id}, dogpolicies://corridor/i-5, dogpolicies://answers, dogpolicies://status",
        "",
        "## Areas",
        "",
        ...ctx.graph.areas.map(
          (a) => `- ${a.name} (\`${a.id}\`, ${a.places} places)`,
        ),
      ].join("\n"),
    }),
  },
  {
    name: "status",
    uri: "dogpolicies://status",
    title: "Server status",
    description:
      "Data version and origin, counts, and this process's call statistics (nothing leaves the machine)",
    mimeType: JSON_TYPE,
    read: () => ({
      text: JSON.stringify(
        {
          package: PACKAGE_NAME,
          version: PACKAGE_VERSION,
          data: {
            as_of: ctx.graph.as_of,
            origin: ctx.source.origin,
            places: ctx.graph.places.length,
            brands: ctx.graph.brands.length,
            answers: ctx.graph.answers.length,
            routes: ctx.graph.routeIds.length,
            towns: ctx.graph.towns.length,
            areas: ctx.graph.areaIds.length,
          },
          network: ctx.config.network,
          base_url: ctx.config.baseUrl,
          today: ctx.today(),
          stats: ctx.stats(),
          uptime_s: Math.round(process.uptime()),
          memory_mb: Math.round(process.memoryUsage().rss / 1e6),
        },
        null,
        2,
      ),
    }),
  },
  {
    name: "answers",
    uri: "dogpolicies://answers",
    title: "Answered questions",
    description: "Every ready-made question with its slug and result count",
    mimeType: TEXT,
    cacheHint: { ttlMs: 3_600_000, cacheScope: "public" },
    read: async () => ({
      text: (await viaTool(ctx, "dogpolicies_browse_answers", {})).content[0]
        .text,
    }),
  },
  {
    name: "place",
    template: {
      uriTemplate: "dogpolicies://place/{id}",
      list: undefined,
      complete: {
        id: (value) =>
          rank(
            ctx.graph.places.map((p) => p.id),
            value,
          ),
      },
    },
    title: "Place record",
    description:
      "One place's dog rules with sources, quotes and rule ids, as markdown",
    mimeType: TEXT,
    cacheHint: { ttlMs: 3_600_000, cacheScope: "public" },
    read: async ({ id }) => {
      const r = await viaTool(ctx, "dogpolicies_get_place", { id: String(id) });
      return found(r);
    },
  },
  {
    name: "brand",
    template: {
      uriTemplate: "dogpolicies://brand/{id}",
      list: () => ({
        resources: ctx.graph.brands.map((b) => ({
          uri: `dogpolicies://brand/${b.id}`,
          name: b.name,
          mimeType: TEXT,
        })),
      }),
      complete: { id: (value) => rank(ctx.graph.brandIds, value) },
    },
    title: "Hotel brand pet policy",
    description:
      "A chain's published pet policy, exceptions and property counts",
    mimeType: TEXT,
    read: async ({ id }) => {
      const r = await viaTool(ctx, "dogpolicies_get_brand_policy", {
        brand: String(id),
      });
      return found(r);
    },
  },
  {
    name: "answer",
    template: {
      uriTemplate: "dogpolicies://answer/{slug}",
      list: undefined,
      complete: {
        slug: (value) =>
          rank(
            ctx.graph.answers.map((a) => a.slug),
            value,
          ),
      },
    },
    title: "Answered question",
    description: "The places that answer one ready-made question",
    mimeType: TEXT,
    read: async ({ slug }) => {
      const r = await viaTool(ctx, "dogpolicies_browse_answers", {
        slug: String(slug),
        limit: 50,
      });
      return found(r);
    },
  },
  {
    name: "route",
    template: {
      uriTemplate: "dogpolicies://route/{id}",
      list: () => ({
        resources: ctx.graph.routeIds.map((id) => ({
          uri: `dogpolicies://route/${id}`,
          name: ctx.graph.routes[id].short,
          mimeType: TEXT,
        })),
      }),
      complete: { id: (value) => rank(ctx.graph.routeIds, value) },
    },
    title: "Highway dog stops",
    description: "Dog-friendly stops along one highway in driving order",
    mimeType: TEXT,
    read: async ({ id }) => {
      if (!ctx.graph.routeIds.includes(String(id))) return null;
      const r = await viaTool(ctx, "dogpolicies_route_stops", {
        route: String(id),
        limit: 50,
      });
      return found(r);
    },
  },
  {
    name: "corridor-i5",
    uri: "dogpolicies://corridor/i-5",
    title: "I-5 corridor",
    description:
      "I-5 in California as eleven stretches on the I-5 centerline (s meters from San Ysidro), with every dog stop at its s, the family stops and the paired stops",
    mimeType: JSON_TYPE,
    cacheHint: { ttlMs: 3_600_000, cacheScope: "public" },
    read: () => {
      const route = ctx.graph.routes["i-5"];
      const axis = route?.axis;
      if (!axis) return null;
      const stops = route.stops
        .filter((s) => s.s_m != null)
        .map((s) => ({
          id: s.place.id,
          name: s.place.name,
          type: s.place.type,
          s_m: s.s_m,
          mile: s.mile,
          side: s.axis_side,
          off_miles: s.off_miles,
          elevation_m: s.elevation_m,
          strip: s.strip,
          status: s.place.status,
          url: s.place.url,
        }));
      return {
        text: JSON.stringify(
          {
            route: "i-5",
            axis_version: axis.version,
            origin: axis.origin,
            ca_end_s: axis.ca_end_s,
            strips: axis.strips,
            stops,
            paired_stops: axis.paired,
            osm_note:
              "Exit numbers, names and people-stop counts are OpenStreetMap data (ODbL, (c) OpenStreetMap contributors); restrooms at a people-stop are not verified.",
            as_of: ctx.graph.as_of,
          },
          null,
          1,
        ),
      };
    },
  },
  {
    name: "area",
    template: {
      uriTemplate: "dogpolicies://area/{id}",
      list: () => ({
        resources: ctx.graph.areas.map((a) => ({
          uri: `dogpolicies://area/${a.id}`,
          name: a.name,
          description: a.blurb ?? undefined,
          mimeType: TEXT,
        })),
      }),
      complete: { id: (value) => rank(ctx.graph.areaIds, value) },
    },
    title: "Area",
    description:
      "Every dog-related place in one area (East Bay, Lake Tahoe, Big Sur), grouped by kind",
    mimeType: TEXT,
    read: async ({ id }) => {
      const area = ctx.graph.areaById.get(String(id));
      if (!area) return null;
      const r = await viaTool(ctx, "dogpolicies_near", {
        place: area.name,
        per_type: 20,
      });
      return found(r);
    },
  },
];
