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

export const reportCorrection = (ctx) => ({
  name: "dogpolicies_report_correction",
  title: "Report a correction",
  since: "0.1.0",
  description: `File a correction when a user says a rule on a record is wrong or has changed (a fee went up, a beach closed to dogs, a hotel now takes two pets). The report goes to a person who re-reads the official source; nothing is published automatically and the record does not change until it is verified. Takes the place id, a sentence or two on what is wrong, and optionally the official page the user saw. The only personal detail it accepts is an optional contact the user offers.`,
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
  }),
  annotations: WRITE_ONCE,
  handler: async ({ place_id, message, source_url, contact }) => {
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
    const data = {
      report_id: sent.id,
      place_id: p.id,
      status: "filed",
      url: p.url,
      note: "A person re-verifies against the official source, usually within a week. The record's verification history shows the result.",
    };
    return result(
      data,
      "markdown",
      () =>
        `Filed correction ${sent.id} for ${p.id}. A person re-verifies it against the official source, usually within a week; the record (${p.url}) does not change until then.`,
    );
  },
});
