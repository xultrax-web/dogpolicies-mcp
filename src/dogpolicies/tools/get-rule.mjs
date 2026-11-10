import * as z from "zod/v4";
import { READ_ONLY } from "../../core/server.mjs";
import { quoteBlock } from "../../core/citation.mjs";
import { ruleWithFreshness } from "../graph.mjs";
import {
  Envelope,
  OutcomeFields,
  PlaceItem,
  RuleItem,
  answer,
  noMatchText,
  pageSchema,
  result,
  summary,
} from "./common.mjs";

export const getRule = (ctx) => ({
  name: "dogpolicies_get_rule",
  title: "Get one rule by id",
  since: "0.1.0",
  cache: true,
  description: `Where does this specific rule come from (a fee, a leash rule, a weight limit): what is the exact quote, the source and the date it was verified?
Takes one rule id and returns the evidence behind that single fact. Rule ids look like "rul_<place uid>_<kind>" and appear in every place result as rule_records.
Returns the rule's value, the source it cites with the quote, confidence, verified date, freshness and the place's citation line.`,
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
    ...OutcomeFields,
    rule: RuleItem.nullable().describe("null in a no_match answer"),
    place: PlaceItem.nullable().describe(
      "The rule's place; in a no_match answer, the place the id names when it exists",
    ),
  }),
  annotations: READ_ONLY,
  handler: async ({ id, response_format }) => {
    const today = ctx.today();
    const m = id.match(/^rul_([a-z0-9]+)_([a-z0-9]+)$/);
    const found = m ? ctx.graph.ruleIndex.get(id) : null;
    if (!found) {
      // The id names a place (by its uid) but a rule it has not recorded: its
      // recorded rules are the close matches. Otherwise, how to find a rule id.
      // a place uid is "plc_<x>"; its rule ids carry the <x>
      const place = m
        ? (ctx.graph.places.find(
            (p) => p.uid === m[1] || p.uid.replace(/^[a-z]+_/, "") === m[1],
          ) ?? null)
        : null;
      const did_you_mean = place
        ? place.rule_records.map((r) => ({
            id: r.id,
            kind: r.kind,
            label: r.label,
            place: place.name,
          }))
        : [];
      const message = place
        ? `${place.name} has no "${m[2]}" rule recorded${place.not_stated.length ? ` (its sources do not state: ${place.not_stated.join(", ")})` : ""}; its recorded rules are listed below.`
        : `No rule with id "${id}". Rule ids look like rul_<place uid>_<kind> and are listed in rule_records of dogpolicies_get_place.`;
      const next = place
        ? [
            `dogpolicies_get_place with id="${place.id}" shows every fact and what is not stated`,
          ]
        : [
            "dogpolicies_search_places, then dogpolicies_get_place, lists a place's rule ids",
          ];
      return answer({
        outcome: "no_match",
        code: "not_found",
        message,
        shape: {
          ...ctx.citations.envelope(ctx.graph.as_of),
          rule: null,
          place: place ? summary(place, today) : null,
        },
        did_you_mean,
        next,
        format: response_format,
        text: noMatchText(ctx, {
          title: `No rule "${id}"`,
          message,
          did_you_mean: [],
          next,
          extraLines: did_you_mean.length
            ? [
                "",
                "Recorded rules:",
                ...did_you_mean.map((r) => `- ${r.label} (\`${r.id}\`)`),
              ]
            : [],
        }),
      });
    }
    const { place: p } = found;
    const r = ruleWithFreshness(found.rule, today);
    const data = {
      ...ctx.citations.envelope(ctx.graph.as_of),
      rule: { ...r, permalink: `${p.url}#rule-${r.kind}` },
      place: summary(p, today),
    };
    const lines = [
      data.place.citation,
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
