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
import { i5Corridor } from "./i5-corridor.mjs";
import { i5Conditions } from "./i5-conditions.mjs";

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
  getRule,
  changesSince,
  changesNear,
  reportCorrection,
];
