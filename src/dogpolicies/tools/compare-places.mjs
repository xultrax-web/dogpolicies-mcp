import * as z from "zod/v4";
import { READ_ONLY } from "../../core/server.mjs";
import { fail } from "../../core/errors.mjs";
import { result } from "../../core/result.mjs";
import { isSafeId } from "../../core/safety.mjs";
import { placeFreshness } from "../graph.mjs";
import { Envelope, OSM_ATTRIBUTION, PlaceItem, summary } from "./common.mjs";

// The facts worth a column, in order; a place without the fact shows "not stated".
const COLUMNS = [
  ["dogsAllowed", "Dogs allowed"],
  ["leash", "Leash"],
  ["areas", "Where"],
  ["fee", "Pet fee"],
  ["weightLimitLb", "Weight limit"],
  ["maxPets", "Pets per room"],
  ["restrictions", "Restrictions"],
];

export const comparePlaces = (ctx) => ({
  name: "dogpolicies_compare_places",
  title: "Compare places side by side",
  since: "0.2.0",
  cache: true,
  description: `Which one is better for a dog? Compare two to six places on the facts that decide a dog trip: dogs allowed, leash rule, where dogs may go, pet fee, weight limit, pets per room, restrictions, plus confidence, freshness and who confirmed each record. One row per fact, one column per place, every place with its citation.

Answers "which one?" between candidates; ids come from any search result. Example: ids=["carmel-beach","asilomar-state-beach"].`,
  inputSchema: z.strictObject({
    ids: z
      .array(z.string().min(2).max(120))
      .min(2)
      .max(6)
      .describe("Two to six place ids from search results"),
    response_format: z
      .enum(["markdown", "json"])
      .default("markdown")
      .describe("'markdown' for readable text, 'json' for structured data"),
  }),
  outputSchema: z.looseObject({
    ...Envelope,
    places: z.array(PlaceItem),
    rows: z.array(
      z.looseObject({
        fact: z.string(),
        label: z.string(),
        values: z.array(z.string()),
      }),
    ),
  }),
  annotations: READ_ONLY,
  handler: async ({ ids, response_format }) => {
    const missing = ids.filter(
      (id) => !isSafeId(id) || !ctx.graph.placeById.has(id),
    );
    if (missing.length)
      return fail(
        "not_found",
        `No place with id ${missing.map((m) => `"${m}"`).join(", ")}. Search first to find ids.`,
      );
    const today = ctx.today();
    const places = ids.map((id) => ctx.graph.placeById.get(id));
    const cell = (p, key) => {
      const row = p.rows.find((r) => r.key === key);
      if (!row)
        return p.not_stated.some(
          (l) => l === COLUMNS.find(([k]) => k === key)?.[1],
        ) || p.facts[key] == null
          ? "not stated"
          : "—";
      return `${row.value}${row.note ? ` (${row.note})` : ""}${row.from_brand_policy ? " [brand policy]" : ""}`;
    };
    const rows = [
      ...COLUMNS.map(([fact, label]) => ({
        fact,
        label,
        values: places.map((p) => cell(p, fact)),
      })),
      {
        fact: "confidence",
        label: "Confidence",
        values: places.map((p) => p.confidence.replaceAll("_", " ")),
      },
      {
        fact: "freshness",
        label: "Freshness",
        values: places.map((p) => placeFreshness(p, today).state),
      },
      {
        fact: "verified_at",
        label: "Verified",
        values: places.map((p) => p.verified_at),
      },
      {
        fact: "confirmed_by",
        label: "Confirmed by",
        values: places.map((p) => p.confirmed_by ?? "not yet"),
      },
      {
        fact: "source",
        label: "Source",
        values: places.map((p) => p.source_urls[0] ?? ""),
      },
    ];
    const items = places.map((p) => summary(p, today));
    const data = {
      ...ctx.citations.envelope(ctx.graph.as_of),
      places: items,
      rows,
      ...(items.some((s) => s.osm) ? { attribution: OSM_ATTRIBUTION } : {}),
    };
    return result(data, response_format, () => {
      const esc = (s) => String(s).replaceAll("|", "\\|").replaceAll("\n", " ");
      const lines = [
        `# ${places.map((p) => p.name).join(" vs ")}`,
        "",
        ...items.map((s) => `- ${s.citation}`),
        "",
        `| Fact | ${places.map((p) => esc(p.name)).join(" | ")} |`,
        `|---|${places.map(() => "---").join("|")}|`,
        ...rows.map((r) => `| ${r.label} | ${r.values.map(esc).join(" | ")} |`),
        ...ctx.citations.footer(items, { osmLine: OSM_ATTRIBUTION }),
      ];
      return lines.join("\n");
    });
  },
});
