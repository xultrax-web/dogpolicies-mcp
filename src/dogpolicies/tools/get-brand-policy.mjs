import * as z from "zod/v4";
import { READ_ONLY } from "../../core/server.mjs";
import { STATE_NAME } from "../stay.mjs";
import {
  Envelope,
  FactItem,
  NotStated,
  OutcomeFields,
  answer,
  editDistance,
  noMatchText,
  norm,
  pageSchema,
  result,
} from "./common.mjs";

const BrandDetail = z.looseObject({
  ...Envelope,
  ...OutcomeFields,
  resolved_from: z
    .string()
    .optional()
    .describe(
      "Set when the name given was not exact and this brand was the one clear match",
    ),
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
    // "Motel Six" is Motel 6; "Red Roof Inns" is Red Roof Inn: number words
    // become digits and a name two letters off is the closest brand, labeled.
    const NUMBERS = {
      one: "1",
      two: "2",
      three: "3",
      four: "4",
      five: "5",
      six: "6",
      seven: "7",
      eight: "8",
      nine: "9",
      ten: "10",
    };
    const plain = (s) =>
      norm(s)
        .replace(
          /\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/g,
          (w) => NUMBERS[w],
        )
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
    const asked = plain(brand);
    let resolvedFrom = null;
    let b =
      ctx.graph.brandById.get(brand) ??
      ctx.graph.brands.find(
        (x) =>
          norm(x.name).includes(norm(brand)) ||
          norm(brand).includes(norm(x.name)),
      );
    if (!b) {
      // not the brand's own spelling: the one brand it plainly means, labeled
      const near = ctx.graph.brands
        .map((x) => ({ x, d: editDistance(plain(x.name), asked, 2) }))
        .filter((c) => c.d <= 2)
        .sort((p, q) => p.d - q.d);
      if (near.length === 1 || (near.length > 1 && near[0].d < near[1].d)) {
        b = near[0].x;
        resolvedFrom = brand;
      }
    }
    if (!b) {
      // The covered brands, nearest spelling first, and the way to a hotel of
      // an uncovered chain (its own page, hotel by hotel).
      const asked = norm(brand);
      const did_you_mean = [...ctx.graph.brands]
        .map((x) => ({
          id: x.id,
          name: x.name,
          kind: "brand",
          d: editDistance(norm(x.name), asked, 8),
        }))
        .sort((x, y) => x.d - y.d || x.name.localeCompare(y.name))
        .map(({ d, ...x }) => x);
      const message = `No verified policy for "${brand}" in the data. The chains with a verified policy are ${ctx.graph.brands.map((x) => x.name).join(", ")}; other chains set pet rules hotel by hotel.`;
      const next = [
        `dogpolicies_find_hotels with query="${brand}" and a town or county checks that chain's hotels one by one where the data has them`,
        ...(did_you_mean[0]
          ? [`brand="${did_you_mean[0].id}" is the closest covered brand`]
          : []),
      ];
      return answer({
        outcome: "no_match",
        code: "not_found",
        message,
        shape: {
          ...ctx.citations.envelope(ctx.graph.as_of),
          id: brand,
          name: brand,
          answer: "No verified brand-wide policy for this chain.",
          facts: [],
          not_stated: [],
          verified_at: "",
          url: `${ctx.graph.site.url}/brands/`,
          source_urls: [],
        },
        did_you_mean,
        next,
        format: response_format,
        text: noMatchText(ctx, {
          title: `No verified policy for "${brand}"`,
          message,
          did_you_mean: [],
          next,
          extraLines: [
            "",
            "Covered brands:",
            ...did_you_mean.map((x) => `- ${x.name} (\`${x.id}\`)`),
          ],
        }),
      });
    }
    const data = {
      ...ctx.citations.envelope(ctx.graph.as_of),
      ...b,
      exceptions: b.exceptions.map(
        (x) => `${x.name} (${STATE_NAME[x.state]}): ${x.note}`,
      ),
      ...(resolvedFrom ? { resolved_from: resolvedFrom } : {}),
    };
    const lines = [
      `# ${b.name} pet policy`,
      ...(resolvedFrom
        ? [`(The closest covered brand to "${resolvedFrom}".)`]
        : []),
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
