import * as z from "zod/v4";
import { READ_ONLY } from "../../core/server.mjs";
import { fail } from "../../core/errors.mjs";
import { quoteBlock } from "../../core/citation.mjs";
import { ruleWithFreshness } from "../graph.mjs";
import {
  Envelope,
  PlaceItem,
  RuleItem,
  pageSchema,
  result,
  summary,
} from "./common.mjs";

export const getRule = (ctx) => ({
  name: "dogpolicies_get_rule",
  title: "Get one rule by id",
  since: "0.1.0",
  cache: true,
  description: `One rule (a fee, a leash rule, a weight limit) by its stable id, with its value, the source it cites, the quote, its confidence, the date it was verified and its freshness, plus the place's citation line. Rule ids look like "rul_<place uid>_<kind>" and appear in every place result as rule_records.`,
  inputSchema: z.strictObject({
    id: z
      .string()
      .min(6)
      .max(80)
      .describe('Rule id, e.g. "rul_t6cqwy0x4ce2dmpq_fee"'),
    response_format: pageSchema.response_format,
  }),
  outputSchema: z.looseObject({
    ...Envelope,
    rule: RuleItem,
    place: PlaceItem,
  }),
  annotations: READ_ONLY,
  handler: async ({ id, response_format }) => {
    const found = /^rul_[a-z0-9]+_[a-z0-9]+$/.test(id)
      ? ctx.graph.ruleIndex.get(id)
      : null;
    if (!found)
      return fail(
        "not_found",
        `No rule with id "${id}". Rule ids are listed in rule_records of dogpolicies_get_place.`,
      );
    const today = ctx.today();
    const { place: p } = found;
    const r = ruleWithFreshness(found.rule, today);
    const data = {
      ...ctx.citations.envelope(ctx.graph.as_of),
      rule: { ...r, permalink: `${p.url}#rule-${r.kind}` },
      place: summary(p, today),
    };
    const lines = [
      p.citation,
      "",
      `${r.label}: ${r.text}${r.note ? ` (${r.note})` : ""}`,
      `Confidence: ${r.confidence.replaceAll("_", " ")}. Verified ${r.verifiedAt}; re-check due ${r.reviewDue}; freshness ${r.freshness}.`,
      `Source: ${r.sourcePublisher}, ${r.sourceUrl}`,
      ...quoteBlock(r.quote),
      `Permalink: ${data.rule.permalink}`,
      ctx.citations.line(r.verifiedAt),
    ];
    return result(data, response_format, () => lines.join("\n"));
  },
});
