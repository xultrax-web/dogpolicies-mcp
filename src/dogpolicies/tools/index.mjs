// The tool list, in the order clients show them. Adding a tool is one line
// here and one file beside it; removing one follows the deprecation policy
// in docs/mcp-architecture.md (deprecate for a minor, remove in a major).

import { searchPlaces } from "./search-places.mjs";
import { getPlace } from "./get-place.mjs";
import { findHotels } from "./find-hotels.mjs";
import { getBrandPolicy } from "./get-brand-policy.mjs";
import { browseAnswers } from "./browse-answers.mjs";
import { routeStops } from "./route-stops.mjs";
import { getRule } from "./get-rule.mjs";
import { changesSince } from "./changes-since.mjs";
import { reportCorrection } from "./report-correction.mjs";
import { near } from "./near.mjs";
import { planTrip } from "./plan-trip.mjs";
import { comparePlaces } from "./compare-places.mjs";
import { changesNear } from "./changes-near.mjs";
import { subscribeChanges } from "./subscribe-changes.mjs";
import { i5Corridor } from "./i5-corridor.mjs";
import { i5Conditions } from "./i5-conditions.mjs";
import { roadConditions } from "./road-conditions.mjs";
import { emergencyVet } from "./emergency-vet.mjs";
import { emptyCall, invalidInput } from "./invalid.mjs";

// A tool whose arguments are all optional, but whose call with none would only list the whole data set,
// answers what it needs instead (decision 136). Only a call with no arguments at all (response_format
// aside) gets it; a call that sends limit or offset alone still lists, as before.
const NEEDS_SOMETHING = {
  dogpolicies_search_places:
    "a query (a place name), a type, a county or area, or near={lat, lon}",
  dogpolicies_find_hotels:
    "a query (a hotel, city or airport), a brand, a county or area, near={lat, lon}, dog_weight_lb or max_total_fee",
};

// Every tool answers arguments it cannot use instead of refusing them (decision 111).
const tolerant = (make) => (ctx) => {
  const tool = { ...make(ctx), invalidAnswer: invalidInput(ctx) };
  const needs = NEEDS_SOMETHING[tool.name];
  if (needs) tool.emptyAnswer = (args) => emptyCall(ctx, tool, args, needs);
  return tool;
};

export const tools = [
  searchPlaces,
  near,
  getPlace,
  comparePlaces,
  planTrip,
  findHotels,
  getBrandPolicy,
  browseAnswers,
  routeStops,
  i5Corridor,
  i5Conditions,
  roadConditions,
  emergencyVet,
  getRule,
  changesSince,
  changesNear,
  subscribeChanges,
  reportCorrection,
].map(tolerant);
