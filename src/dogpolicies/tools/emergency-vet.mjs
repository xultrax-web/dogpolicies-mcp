// dogpolicies_emergency_vet (R-29, 0.6.0): the nearest 24-hour and emergency animal hospitals to a
// town, landmark or point, each from the hospital's own page. Where and when only; never advice.

import * as z from "zod/v4";
import { READ_ONLY } from "../../core/server.mjs";
import { result } from "../../core/result.mjs";
import { Envelope, OutcomeFields, formatSchema } from "./common.mjs";
import { resolveScope, scopeAnswer, scopeSchema } from "./scope.mjs";
import { flag } from "./tolerant.mjs";
import { CARD_URI } from "../ui/trip-card.mjs";
import { VET_CAVEAT, nearestVets, serviceText, vetLine } from "./vets.mjs";

const num = () => z.coerce.number();
const VetItem = z.looseObject({
  id: z.string(),
  name: z.string(),
  address: z.string(),
  city: z.string(),
  state: z.string(),
  phone: z.string(),
  website: z.string(),
  emergency: z.enum(["24_7", "emergency_hours"]),
  hours: z.string().optional(),
  distance_miles: z.number().optional(),
  verified_at: z.string(),
  source_url: z.string(),
});

export const emergencyVet = (ctx) => ({
  name: "dogpolicies_emergency_vet",
  title: "Nearest emergency vet",
  since: "0.6.0",
  cache: true,
  ui: { resourceUri: CARD_URI },
  description: `Where is the nearest 24-hour or emergency animal hospital to this town, landmark or point: "my dog ate something near Kettleman City", "emergency vet near South Lake Tahoe tonight"?
Returns the nearest hospitals with address, phone number, whether they are open 24 hours every day or take emergencies in published hours, the straight-line distance, the hospital's own page and the date it was read. Mountain and desert stretches often have none close: the answer then names the nearest one anyway with its distance.
It gives where, when and the phone number only: never medical advice. Tell the traveler to call ahead.
Inputs: place as people say it (a city, county, neighborhood, airport) or near={lat, lon}; radius_miles (default 60, up to 200); open_24h_only (default false).

Examples:
  - "My dog ate chocolate, we are near Kettleman City" -> place="Kettleman City"
  - "24-hour vet near South Lake Tahoe" -> place="South Lake Tahoe", open_24h_only=true
  - "Emergency vet near here" -> near={lat:38.68, lon:-119.75}`,
  inputSchema: z.strictObject({
    place: scopeSchema.place,
    near: scopeSchema.near,
    radius_miles: num().min(1).max(200).default(60).describe("How far to look, in miles (straight line)"),
    open_24h_only: flag(false).describe("Only hospitals open 24 hours every day"),
    limit: num().int().min(1).max(10).default(5).describe("Hospitals to list"),
    response_format: formatSchema().describe("'markdown' for readable text, 'json' for structured data"),
  }),
  outputSchema: z.looseObject({
    ...Envelope,
    ...OutcomeFields,
    center: z.looseObject({ lat: z.number(), lon: z.number() }).nullable(),
    label: z.string(),
    radius_miles: z.number(),
    total: z.number(),
    vets: z.array(VetItem),
    nearest_24h: VetItem.nullable().optional().describe("The nearest 24-hour hospital at any distance, when none is inside the radius"),
    caveat: z.string(),
  }),
  annotations: READ_ONLY,
  handler: async (args) => {
    const scope = resolveScope(ctx, { ...args, radius_miles: Math.min(args.radius_miles, 100) });
    const format = args.response_format;
    if (scope.noMatch)
      return scopeAnswer(ctx, scope.noMatch, {
        format,
        placesOnly: true,
        shape: { center: null, label: args.place ?? "", radius_miles: args.radius_miles, total: 0, vets: [], caveat: VET_CAVEAT },
      });
    const radius = args.radius_miles;
    const vets = nearestVets(ctx, scope.center, { n: args.limit, radius, only24: args.open_24h_only });
    const has24 = vets.some((v) => v.emergency === "24_7");
    const nearest24h = has24 ? null : nearestVets(ctx, scope.center, { n: 1, only24: true })[0] ?? null;
    const envelope = ctx.citations.envelope(ctx.graph.as_of);
    const data = {
      ...envelope,
      center: scope.center,
      label: scope.label,
      radius_miles: radius,
      total: vets.length,
      vets,
      ...(nearest24h ? { nearest_24h: nearest24h } : {}),
      caveat: VET_CAVEAT,
      ...(vets.length
        ? {}
        : {
            outcome: "no_match",
            code: "none_within_radius",
            message: `No emergency animal hospital in the data within ${radius} miles of ${scope.label}.${nearest24h ? ` The nearest 24-hour hospital is ${nearest24h.name} in ${nearest24h.city}, ${nearest24h.distance_miles} miles away.` : ""}`,
            next: nearest24h ? [`Call ${nearest24h.name} at ${nearest24h.phone} before driving over`] : ["Call your own vet for advice on where to go"],
          }),
    };
    return result(data, format, () => {
      const lines = [`# Emergency vets near ${scope.label}`, ""];
      if (vets.length) vets.forEach((v, i) => lines.push(`${i + 1}. ${vetLine(v)}  `, `   Source: ${v.source_url} (read ${v.verified_at})`));
      else lines.push(data.message);
      if (nearest24h && vets.length) lines.push("", `None of these is open 24 hours. The nearest that is: ${vetLine(nearest24h)}`);
      lines.push("", VET_CAVEAT, "", `Data: ${envelope.attribution_text}.`);
      return lines.join("\n");
    });
  },
});

export { serviceText };
