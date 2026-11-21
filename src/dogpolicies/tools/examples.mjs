// One working call per tool, shown in the answer to a call that came without what the tool needs (decision 136).
// A test runs every example through the tool's own schema, so an example cannot drift from the tool.

export const EXAMPLES = Object.freeze({
  dogpolicies_search_places: { query: "Point Lobos" },
  dogpolicies_near: { place: "Carmel" },
  dogpolicies_get_place: { id: "carmel-beach" },
  dogpolicies_compare_places: { ids: ["carmel-beach", "fiesta-island"] },
  dogpolicies_plan_trip: { place: "Lake Tahoe", nights: 3, dogs: 2 },
  dogpolicies_find_hotels: {
    county: "Monterey",
    dog_weight_lb: 70,
    max_total_fee: 50,
  },
  dogpolicies_get_brand_policy: { brand: "motel-6" },
  dogpolicies_browse_answers: { slug: "off-leash-dog-beaches-california" },
  dogpolicies_route_stops: {
    route: "I-5",
    direction: "north",
    from_mile: 200,
    to_mile: 300,
  },
  dogpolicies_i5_corridor: { from_mile: 200, to_mile: 300 },
  dogpolicies_i5_conditions: {},
  dogpolicies_road_conditions: { route: "I-80" },
  dogpolicies_emergency_vet: { place: "Kettleman City" },
  dogpolicies_get_rule: { id: "carmel-beach" },
  dogpolicies_changes_since: { since: "2026-10-01" },
  dogpolicies_changes_near: { place: "Carmel", since: "2026-10-01" },
  dogpolicies_subscribe_changes: { route: "I-80" },
  dogpolicies_report_correction: {
    place_id: "carmel-beach",
    message: "The sign now says dogs must be on a 6 foot leash.",
  },
});

/** The example as a call in words: `dogpolicies_get_place {"id":"carmel-beach"}`. */
export const exampleCall = (name) =>
  EXAMPLES[name] ? `${name} ${JSON.stringify(EXAMPLES[name])}` : null;
