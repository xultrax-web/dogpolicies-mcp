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

export const tools = [
  searchPlaces,
  getPlace,
  findHotels,
  getBrandPolicy,
  browseAnswers,
  routeStops,
  getRule,
  changesSince,
  reportCorrection,
];
