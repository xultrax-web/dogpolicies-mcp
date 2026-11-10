import * as z from "zod/v4";
import { READ_ONLY } from "../../core/server.mjs";
import {
  Envelope,
  OutcomeFields,
  PlaceItem,
  answer,
  editDistance,
  listResponse,
  noMatchText,
  pageSchema,
  result,
  summary,
} from "./common.mjs";

const AnswersOutput = z.looseObject({
  ...Envelope,
  ...OutcomeFields,
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
  description: `Which places match a common question, as a ready-made list: California national parks that allow dogs, off-leash dog beaches in California, state parks that allow dogs?
Covers broad "list the ..." questions that are not about one town. Each list is fixed; it takes no county, type or off-leash filter.
Without a slug it lists every question with its slug and result count; with a slug it returns that question's places (for example "off-leash-dog-beaches-california"), each with the dog rule, verified date and URL.`,
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
    if (!a) {
      // The questions that share words with the slug, then the whole list, so
      // the next call can be the right one.
      const asked = slug
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
      const words = asked.split(" ").filter((w) => w.length >= 3);
      const list = ctx.graph.answers.map((q) => ({
        slug: q.slug,
        question: q.question,
        results: q.place_ids.length,
        url: `${site}/answers/${q.slug}/`,
      }));
      const did_you_mean = list
        .map((q) => {
          const hay = `${q.slug.replace(/-/g, " ")} ${q.question.toLowerCase()}`;
          const hits = words.filter((w) => hay.includes(w)).length;
          const d = editDistance(q.slug, slug.toLowerCase(), 6);
          return { q, score: hits ? -hits : d <= 6 ? 10 + d : null };
        })
        .filter((x) => x.score !== null)
        .sort((x, y) => x.score - y.score)
        .slice(0, 5)
        .map((x) => x.q);
      const message = `No answered question has the slug "${slug}".`;
      const next = [
        ...(did_you_mean[0]
          ? [`slug="${did_you_mean[0].slug}" is the closest`]
          : []),
        "Every question is listed below; call again with one of their slugs",
      ];
      return answer({
        outcome: "no_match",
        code: "not_found",
        message,
        shape: {
          ...ctx.citations.envelope(ctx.graph.as_of),
          total: list.length,
          questions: list,
        },
        did_you_mean,
        next,
        format: response_format,
        text: noMatchText(ctx, {
          title: `No question "${slug}"`,
          message,
          did_you_mean,
          next,
          extraLines: [
            "",
            `All ${list.length} questions:`,
            ...list.map((q) => `- ${q.question} (${q.results}) \`${q.slug}\``),
          ],
        }),
      });
    }
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
