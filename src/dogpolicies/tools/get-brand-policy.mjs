import * as z from "zod/v4";
import { READ_ONLY } from "../../core/server.mjs";
import { fail } from "../../core/errors.mjs";
import { STATE_NAME } from "../stay.mjs";
import {
  Envelope,
  FactItem,
  NotStated,
  norm,
  pageSchema,
  result,
} from "./common.mjs";

const BrandDetail = z.looseObject({
  ...Envelope,
  id: z.string(),
  name: z.string(),
  answer: z.string(),
  facts: z.array(FactItem),
  not_stated: NotStated,
  verified_at: z.string(),
  url: z.string(),
  source_urls: z.array(z.string()),
});

export const getBrandPolicy = (ctx) => ({
  name: "dogpolicies_get_brand_policy",
  title: "Get hotel brand pet policy",
  since: "0.1.0",
  cache: true,
  description: `A hotel chain's published pet policy: pets per room, weight limit, fee, rules, listed exceptions and how many California and Nevada properties carry it.

Brands covered: ${ctx.graph.brands.map((b) => `${b.name} (${b.id})`).join(", ")}. Example: brand="red-roof" or brand="Kimpton".`,
  inputSchema: z.strictObject({
    brand: z.string().min(2).max(60).describe("Brand id or name"),
    response_format: pageSchema.response_format,
  }),
  outputSchema: BrandDetail,
  annotations: READ_ONLY,
  handler: async ({ brand, response_format }) => {
    const b =
      ctx.graph.brandById.get(brand) ??
      ctx.graph.brands.find(
        (x) =>
          norm(x.name).includes(norm(brand)) ||
          norm(brand).includes(norm(x.name)),
      );
    if (!b)
      return fail(
        "not_found",
        `No verified policy for "${brand}". Covered brands: ${ctx.graph.brandIds.join(", ")}. Other chains set pet rules hotel by hotel.`,
      );
    const data = {
      ...ctx.citations.envelope(ctx.graph.as_of),
      ...b,
      exceptions: b.exceptions.map(
        (x) => `${x.name} (${STATE_NAME[x.state]}): ${x.note}`,
      ),
    };
    const lines = [
      `# ${b.name} pet policy`,
      "",
      `**${b.answer}**`,
      `Applies to: ${b.applies_to}`,
      "",
      ...b.facts.map(
        (f) => `- ${f.label}: ${f.value}${f.note ? ` (${f.note})` : ""}`,
      ),
      ...b.not_stated.map((l) => `- ${l}: not stated by the source`),
      ...(b.rules.length ? ["", ...b.rules.map((r) => `- ${r}`)] : []),
      ...(data.exceptions.length
        ? [
            "",
            "Locations that do not allow pets:",
            ...data.exceptions.map((x) => `- ${x}`),
          ]
        : []),
      "",
      `${b.california_properties} California and ${b.nevada_properties} Nevada properties carry this policy. Official policy: ${b.source}. Verified ${b.verified_at}. ${b.url}`,
      ctx.citations.line(b.verified_at),
    ];
    return result(data, response_format, () => lines.join("\n"));
  },
});
