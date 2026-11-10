// Public correction tickets for the change tools (R-14). The hosted server hands
// the runtime a loader (ctx.corrections, backed by its database, like
// ctx.conditions); this server in-process, on stdio or offline has none, and says so.
// A ticket is public as its id, the place, the kind of fact, the status, dates and a
// reason category: nothing a reporter wrote ever reaches here.

import * as z from "zod/v4";

export const MAX_CORRECTIONS = 50;

/**
 * How long the host's correction list may take (the hosted loader is a D1 batch, behind
 * the schema batch on a cold start) before the change tools answer without it.
 */
export const CORRECTIONS_READ_MS = 2_000;

export const CorrectionItem = z.looseObject({
  ticket: z.string(),
  place_id: z.string(),
  place_name: z.string(),
  fact: z.string().describe("Kind of fact, or unspecified"),
  status: z.string().describe("filed, verified or rejected"),
  filed_at: z.string().nullable(),
  decided_at: z.string().nullable(),
  changed_at: z.string().describe("When the status last changed"),
  reason: z
    .string()
    .nullable()
    .describe(
      "For a rejection: not_supported_by_source, duplicate, out_of_scope, could_not_verify or spam",
    ),
  status_url: z.string(),
});

/** The fields every change tool adds to its answer. All optional/nullable: older clients ignore them. */
export const CorrectionsFields = {
  corrections: z
    .array(CorrectionItem)
    .optional()
    .describe(
      "Corrections people filed or whose status changed in the window (the hosted server only), newest first",
    ),
  corrections_total: z.number().optional(),
  corrections_note: z
    .string()
    .nullable()
    .optional()
    .describe("Why corrections is empty when this server cannot list them"),
};

/**
 * @param {object} ctx the runtime context
 * @param {{ since: string, placeIds?: Map<string, number> }} q placeIds limits to places (id -> distance, miles)
 */
export async function loadCorrections(ctx, { since, placeIds }) {
  const where = `${ctx.graph.site.url}/api/v1/corrections.json`;
  if (!ctx.corrections)
    return {
      corrections: [],
      corrections_total: 0,
      corrections_note: `This server does not list correction tickets; the hosted server at ${ctx.graph.site.url}/mcp/ does. The public list is at ${where}.`,
    };
  let timer;
  try {
    // A deadline like every other live read (closuresFor waits 1.5 s): a slow or stalled
    // database read goes the "could not be read just now" way instead of holding the answer.
    const { items } = await Promise.race([
      ctx.corrections({ since, limit: 500 }),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`no answer in ${CORRECTIONS_READ_MS} ms`)),
          CORRECTIONS_READ_MS,
        );
      }),
    ]);
    const mine = items
      .filter((t) => !placeIds || placeIds.has(t.place_id))
      .map((t) => ({
        ...t,
        changed_at: t.decided_at ?? t.filed_at,
        ...(placeIds ? { distance_miles: placeIds.get(t.place_id) } : {}),
      }))
      .sort(
        (a, b) =>
          b.changed_at.localeCompare(a.changed_at) ||
          a.ticket.localeCompare(b.ticket),
      );
    return {
      corrections: mine.slice(0, MAX_CORRECTIONS),
      corrections_total: mine.length,
      corrections_note: null,
    };
  } catch {
    return {
      corrections: [],
      corrections_total: 0,
      corrections_note: `The correction list could not be read just now; it is at ${where}.`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Markdown lines for the corrections block; empty when there is nothing to say. */
export function correctionLines(c) {
  if (c.corrections_note) return ["", `Corrections: ${c.corrections_note}`];
  if (!c.corrections.length) return [];
  const word = {
    filed: "filed",
    verified: "verified (the record was updated)",
    rejected: "rejected",
  };
  return [
    "",
    `Corrections (${c.corrections_total}):`,
    ...c.corrections.map(
      (t) =>
        `- ${t.changed_at} ${t.place_name}: ${t.fact === "unspecified" ? "" : t.fact.replaceAll("_", " ") + " "}correction ${t.ticket} ${word[t.status] ?? t.status}${t.reason ? `, ${t.reason.replaceAll("_", " ")}` : ""} · ${t.status_url}`,
    ),
  ];
}
