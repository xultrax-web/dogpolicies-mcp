import * as z from "zod/v4";
import { READ_ONLY } from "../../core/server.mjs";
import { fail } from "../../core/errors.mjs";
import { quoteBlock } from "../../core/citation.mjs";
import { isSafeId } from "../../core/safety.mjs";
import { placeFreshness, ruleWithFreshness } from "../graph.mjs";
import {
  Envelope,
  FactItem,
  NotStated,
  OSM_ATTRIBUTION,
  PlaceItem,
  RuleItem,
  pageSchema,
  result,
  summary,
} from "./common.mjs";
import { I5, axisOf, pairRow, pairLine } from "../i5.mjs";

const PlaceDetail = PlaceItem.extend({
  ...Envelope,
  facts: z.array(FactItem),
  rule_records: z.array(RuleItem),
  not_stated: NotStated,
  rules: z.array(z.string()),
  sources: z.array(
    z.looseObject({
      url: z.string(),
      publisher: z.string(),
      checked: z.string(),
    }),
  ),
  review_due: z.string(),
  axis: z
    .looseObject({
      route: z.string(),
      s: z.number(),
      mile: z.number(),
      offM: z.number(),
      side: z.string(),
      ele: z.number(),
      strip: z.string(),
    })
    .nullable()
    .describe(
      "Where the place sits on the I-5 axis: s meters from San Ysidro, Caltrans mile, meters off the road, side of northbound travel, road elevation, strip; null off I-5",
    ),
  paired_stop: z.looseObject({}).nullable(),
});

export const getPlace = (ctx) => ({
  name: "dogpolicies_get_place",
  title: "Get place details",
  since: "0.1.0",
  cache: true,
  description: `The full record for one place you already know by id: every dog rule with its display text, the rules list, and each source with its URL, publisher, capture date and quote. A place on I-5 in California also carries its axis position (s meters from San Ysidro on the I-5 centerline, Caltrans mile, meters off the road, side of northbound travel, road elevation, strip) and, when it is the dog side of a paired stop, that pair: the exit and the people-stops near it (counted from OpenStreetMap, never named, not verified for restrooms).

Takes a place id, as returned in every search result. Example: id="carmel-beach".`,
  inputSchema: z.strictObject({
    id: z.string().min(2).max(120).describe('Place id, e.g. "fort-funston"'),
    response_format: pageSchema.response_format,
  }),
  outputSchema: PlaceDetail,
  annotations: READ_ONLY,
  handler: async ({ id, response_format }) => {
    const p = isSafeId(id) ? ctx.graph.placeById.get(id) : null;
    if (!p)
      return fail(
        "not_found",
        `No place with id "${id}". Call dogpolicies_search_places with a name to find the id.`,
      );
    const today = ctx.today();
    const fresh = placeFreshness(p, today);
    const rules = p.rule_records.map((r) => ruleWithFreshness(r, today));
    const axis = axisOf(ctx.graph.routes[I5]);
    const pair = axis
      ? (axis.paired ?? []).find((x) => x.dogStop.placeId === p.id)
      : null;
    const pairedStop = pair ? pairRow(pair, ctx.graph) : null;
    const data = {
      ...ctx.citations.envelope(ctx.graph.as_of),
      ...summary(p, today),
      managing_agency: p.managing_agency,
      brand: p.brand,
      address: p.address,
      geo: p.geo,
      facts: p.rows.map(({ key, ...r }) => r),
      rule_records: rules,
      not_stated: p.not_stated,
      rules: p.rules,
      sources: p.sources,
      review_due: p.review_due,
      record_license: p.record_license,
      axis: p.axis ?? null,
      paired_stop: pairedStop,
      ...(p.osm ? { attribution: OSM_ATTRIBUTION } : {}),
    };
    const ruleBy = Object.fromEntries(rules.map((r) => [r.kind, r]));
    const lines = [
      p.citation,
      "",
      `# ${p.name}`,
      "",
      `**${p.answer}**`,
      "",
      ...p.rows.map((f) => {
        const r = ruleBy[f.key];
        return `- ${f.label}: ${f.value}${f.note ? ` (${f.note})` : ""} [${f.source}]${f.from_brand_policy ? " (brand policy)" : ""}${r ? ` · verified ${r.verifiedAt}, ${r.freshness}, ${r.confidence.replaceAll("_", " ")} · rule id ${r.id}` : ""}`;
      }),
      ...p.not_stated.map((l) => `- ${l}: not stated by the source`),
      ...(p.rules.length
        ? ["", "Rules:", ...p.rules.map((r) => `- ${r}`)]
        : []),
      ...(p.axis
        ? [
            "",
            `On I-5 at mile ${p.axis.mile.toFixed(1)}, ${(p.axis.offM / 1609.344).toFixed(1)} mi off the freeway, ${p.axis.side === "both" ? "both directions" : p.axis.side === "right" ? "northbound side" : "southbound side"}, road at ${Math.round(p.axis.ele * 3.28084).toLocaleString("en-US")} ft (${p.axis.ele} m) elevation.`,
          ]
        : []),
      ...(pairedStop
        ? [
            "",
            "Paired stop (the dog side of an exit pairing):",
            pairLine(pairedStop),
            "Exit numbers and people-stop counts are OpenStreetMap data (ODbL); restrooms at a people-stop are not verified.",
          ]
        : []),
      "",
      "Sources:",
      ...p.sources.flatMap((s) => [
        `${s.n}. ${s.publisher}, "${s.title}" (${s.kind}, checked ${s.checked}) ${s.url}`,
        ...quoteBlock(s.quote),
      ]),
      "",
      `Verified ${p.verified_at}; re-check due ${p.review_due}; freshness ${fresh.state}${p.confirmed_by ? `; confirmed by the ${p.confirmed_by}` : ""}. Page: ${p.url} · Markdown: ${p.markdown_url}`,
      ctx.citations.line(p.verified_at),
      ...(p.osm ? [OSM_ATTRIBUTION] : []),
    ];
    return result(data, response_format, () => lines.join("\n"));
  },
});
