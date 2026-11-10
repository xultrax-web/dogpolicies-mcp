// The one write: files a correction with the hosted inbox. Nothing is
// published; a person re-reads the official source. The package rate-limits
// itself, sends only what the schema allows, and when the site cannot be
// reached (or the server runs offline) it hands back the web form URL
// instead of failing silently.

import * as z from "zod/v4";
import { WRITE_ONCE } from "../../core/server.mjs";
import { fail } from "../../core/errors.mjs";
import { isSafeId } from "../../core/safety.mjs";
import {
  OutcomeFields,
  answer,
  closestPlace,
  noMatchText,
  result,
  suggestPlaces,
} from "./common.mjs";

// What a report is about, from a fixed list; shown on the public ticket (never free text).
export const FACT_KINDS = [
  "dogs_allowed",
  "leash",
  "fee",
  "weight_or_size_limit",
  "number_of_pets",
  "breed_rule",
  "hours",
  "areas",
  "closed_or_moved",
  "other",
];

export const reportCorrection = (ctx) => ({
  name: "dogpolicies_report_correction",
  title: "Report a correction",
  since: "0.1.0",
  description: `Tell us a rule is wrong: the fee went up, a beach closed to dogs, a hotel now takes two pets.
For a record the traveler says is wrong or out of date; this is the one tool that writes. The report goes to a person who re-reads the official source, and the record does not change until it is verified: a report is filed, not a fix.
Inputs: place_id from a result, message (what is wrong, in the traveler's words), optional fact (which kind of fact is wrong), optional source_url of the official page, optional contact if the traveler offers one. No other personal detail is accepted.
The answer carries a ticket id and a status_url. The ticket's status (filed, then verified or rejected) is public there; what they wrote is not.`,
  inputSchema: z.strictObject({
    place_id: z
      .string()
      .min(2)
      .max(120)
      .describe("Place id from a search result"),
    message: z
      .string()
      .min(5)
      .max(2000)
      .describe("What is wrong, in the user's words"),
    fact: z
      .enum(FACT_KINDS)
      .optional()
      .describe(
        "What kind of rule is wrong, if clear. Shown on the public ticket; the message is not.",
      ),
    source_url: z
      .string()
      .url()
      .max(500)
      .optional()
      .describe(
        "The official page that shows the current rule, if the user has it",
      ),
    contact: z
      .string()
      .max(200)
      .optional()
      .describe("How to reach the reporter, only if they offer it"),
  }),
  outputSchema: z.looseObject({
    ...OutcomeFields,
    report_id: z.string().nullable(),
    place_id: z.string(),
    status: z
      .string()
      .describe("filed, or not_sent with form_url to file it by hand"),
    url: z.string(),
    form_url: z.string().optional(),
    ticket: z
      .string()
      .nullable()
      .optional()
      .describe("Public ticket id (c-xxxxxxxx) once filed; null otherwise"),
    status_url: z
      .string()
      .nullable()
      .optional()
      .describe(
        "Where the ticket's status (filed, verified, rejected) is public",
      ),
  }),
  annotations: WRITE_ONCE,
  // arguments that fail the schema file nothing, and say so
  invalidShape: { status: "not_sent", report_id: null },
  handler: async ({ place_id, message, source_url, contact, fact }) => {
    const p =
      (isSafeId(place_id) ? ctx.graph.placeById.get(place_id) : null) ??
      closestPlace(ctx.graph, place_id);
    if (!p) {
      const did_you_mean = suggestPlaces(ctx.graph, place_id);
      const why = `No place with id "${place_id}" in the data, so nothing was filed.`;
      const next = [
        ...(did_you_mean[0]
          ? [`place_id="${did_you_mean[0].id}" if that is the record meant`]
          : []),
        "dogpolicies_search_places finds the record and its id; then file again",
      ];
      return answer({
        outcome: "bad_input",
        code: "not_found",
        message: why,
        shape: {
          report_id: null,
          place_id,
          status: "not_sent",
          url: `${ctx.graph.site.url}/search/`,
        },
        did_you_mean,
        next,
        text: noMatchText(ctx, {
          title: "Correction not filed",
          message: why,
          did_you_mean,
          next,
        }),
      });
    }
    const formUrl = `${p.url}#correction`;
    if (source_url && !/^https?:\/\//.test(source_url))
      return answer({
        outcome: "bad_input",
        code: "invalid",
        message: `source_url must start with http:// or https://; nothing was filed. Leave it out, or file on the record's page: ${formUrl}`,
        shape: {
          report_id: null,
          place_id: p.id,
          status: "not_sent",
          url: p.url,
          form_url: formUrl,
        },
        next: [
          "Call again without source_url, or with the official page's full address",
        ],
      });
    const manual = {
      report_id: null,
      place_id: p.id,
      status: "not_sent",
      url: p.url,
      form_url: formUrl,
    };
    if (!ctx.report)
      return result(
        manual,
        "markdown",
        () =>
          `This server has no site configured (or runs offline), so the correction was not sent. File it on the record's page instead: ${formUrl}`,
      );
    if (!ctx.report.underLimit())
      return fail(
        "rate_limited",
        "Too many reports from this client in a minute; wait a minute and try again.",
      );
    const sent = await ctx.report.send({
      placeId: p.id,
      message,
      sourceUrl: source_url,
      contact,
      fact,
      placeName: p.name,
    });
    if (!sent.ok)
      // The inbox is down, not the request: the form takes the same report.
      return answer({
        outcome: "unavailable",
        code: "unavailable",
        message: `The corrections inbox could not be reached (${sent.reason}), so the report was not filed. File it on the record's page instead: ${formUrl}`,
        shape: { ...manual },
        next: [
          `Open ${formUrl} and paste the same message`,
          "Or call again in a few minutes",
        ],
      });
    const ticket = /^c-[a-z2-7]{8}$/.test(String(sent.ticket ?? ""))
      ? sent.ticket
      : null;
    // The status page exists where the report reached the hosted database.
    const statusUrl =
      ticket && sent.public
        ? `${ctx.graph.site.url}/corrections/status/${ticket}/`
        : null;
    const data = {
      report_id: sent.id,
      ticket,
      status_url: statusUrl,
      place_id: p.id,
      status: "filed",
      url: p.url,
      note: statusUrl
        ? "A person re-verifies against the official source, usually within a week. Tell the user the ticket id and status_url: the ticket shows filed, then verified or rejected, with dates. The record's verification history shows the result."
        : "A person re-verifies against the official source, usually within a week. The record's verification history shows the result.",
    };
    return result(
      data,
      "markdown",
      () =>
        `Filed correction ${statusUrl ? `${ticket} (report ${sent.id})` : sent.id} for ${p.id}. A person re-verifies it against the official source, usually within a week; the record (${p.url}) does not change until then.${statusUrl ? ` Its status is public at ${statusUrl}: filed now, then verified or rejected.` : ""}`,
    );
  },
});
