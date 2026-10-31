import * as z from "zod/v4";
import { READ_ONLY } from "../../core/server.mjs";
import { fail } from "../../core/errors.mjs";
import {
  Envelope,
  PlaceItem,
  listResponse,
  pageSchema,
  result,
  summary,
} from "./common.mjs";

const AnswersOutput = z.looseObject({
  ...Envelope,
  total: z.number(),
  questions: z
    .array(
      z.looseObject({
        slug: z.string(),
        question: z.string(),
        results: z.number(),
        url: z.string(),
      }),
    )
    .optional(),
  places: z.array(PlaceItem).optional(),
});

export const browseAnswers = (ctx) => ({
  name: "dogpolicies_browse_answers",
  title: "Browse answered questions",
  since: "0.1.0",
  cache: true,
  description: `Ready-made lists that answer common questions (list the state parks, national parks, beaches or hotels that allow dogs), such as "Which California national parks allow dogs?" or "Where can dogs go off leash on California beaches?".

Without a slug, lists every question with its slug and result count. With a slug, returns that question's places.`,
  inputSchema: z.strictObject({
    slug: z
      .string()
      .min(3)
      .max(120)
      .optional()
      .describe(
        'Question slug from the list, e.g. "off-leash-dog-beaches-california"',
      ),
    ...pageSchema,
  }),
  outputSchema: AnswersOutput,
  annotations: READ_ONLY,
  handler: async ({ slug, limit, offset, response_format }) => {
    const site = ctx.graph.site.url;
    if (!slug) {
      const list = ctx.graph.answers.map((a) => ({
        slug: a.slug,
        question: a.question,
        results: a.place_ids.length,
        url: `${site}/answers/${a.slug}/`,
      }));
      const data = {
        ...ctx.citations.envelope(ctx.graph.as_of),
        total: list.length,
        questions: list,
      };
      return result(data, response_format, () =>
        [
          `# ${list.length} answered questions`,
          "",
          ...list.map((q) => `- ${q.question} (${q.results}) \`${q.slug}\``),
        ].join("\n"),
      );
    }
    const a = ctx.graph.answerBySlug.get(slug);
    if (!a)
      return fail(
        "not_found",
        `Unknown slug "${slug}". Call dogpolicies_browse_answers without a slug to list them.`,
      );
    const today = ctx.today();
    const places = a.place_ids
      .map((id) => ctx.graph.placeById.get(id))
      .filter(Boolean);
    const page = places
      .slice(offset, offset + limit)
      .map((p) => summary(p, today));
    return listResponse(ctx, {
      format: response_format,
      total: places.length,
      offset,
      items: page,
      key: "places",
      header: `# ${a.question}\n\n${a.intro}`,
      extra: { question: a.question, url: `${site}/answers/${a.slug}/` },
    });
  },
});
