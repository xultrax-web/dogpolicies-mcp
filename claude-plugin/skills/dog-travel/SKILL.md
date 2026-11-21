---
name: dog-travel
description: Answers dog and pet travel questions for California and Nevada from DogPolicies, using its sourced records. Use when someone asks whether a park, beach, trail, campground, hotel or patio allows dogs, about pet fees, weight limits or leash rules, hotels for a dog of a given size, dog stops on I-5, I-80, US-50, I-15 or US-395, road conditions or chains on those routes, the nearest emergency vet on a drive, or a dog-friendly trip plan. Not for service-animal law, places outside California and Nevada, or live room rates and booking.
---

# Dog travel in California and Nevada

DogPolicies holds published dog rules for California and Nevada (Nevada is thin). Every record has its official source, a quote and the date it was checked. Call the DogPolicies tools for these questions instead of answering from memory: rules change, and the records say when each was last read.

## When not to use it

- Service animals. They fall under the ADA, not pet rules. Say so; do not answer from pet policies.
- Anywhere outside California and Nevada. Say it is outside the data.
- Live room rates, availability or booking. DogPolicies has pet fees only, never room prices, and cannot book or take payment.
- Legal or medical advice. The vet tool gives where and when only.

## Which tool answers which question

- What can my dog do in a town, neighborhood or region: `dogpolicies_near`.
- Are dogs allowed at a named place, or which parks, beaches or patios match a filter: `dogpolicies_search_places`, then `dogpolicies_get_place` for the full rule and source.
- Which hotel takes my dog, and the pet fee for the stay: `dogpolicies_find_hotels` (weight, dogs, nights, fee budget). One chain's policy: `dogpolicies_get_brand_policy`.
- A whole trip with places to stay, things to do and food: `dogpolicies_plan_trip`.
- Which of two or more places is better for my dog: `dogpolicies_compare_places`. A ready-made list such as California national parks that allow dogs: `dogpolicies_browse_answers`.
- Where to stop on a drive: `dogpolicies_route_stops` for any listed highway by mile and direction. On I-5 also `dogpolicies_i5_corridor` (by stretch) and `dogpolicies_i5_conditions`.
- Chain controls and closures on I-80, US-50, I-15, US-395 or I-5: `dogpolicies_road_conditions`.
- The nearest 24-hour or emergency vet: `dogpolicies_emergency_vet`. Tell the traveler to call ahead.
- What changed since a past trip: `dogpolicies_changes_near` for a destination, `dogpolicies_changes_since` for everything. Evidence for one rule: `dogpolicies_get_rule`. Feed links to follow changes: `dogpolicies_subscribe_changes`.
- A rule that looks wrong: `dogpolicies_report_correction`. It files the report for a person to verify. Say it was filed, not fixed.

A call with missing arguments returns what the tool needs and an example. Read it and call again with the example's shape.

## How to cite

For each fact give the rule in plain words, the quote or source name, the date it was verified, and the DogPolicies record link (dogpolicies.com). Check `confidence` and freshness on each record: if a rule is inferred from an agency or inherited from a hotel brand, or its freshness is stale, tell the traveler to confirm with the place before the visit. A fact listed as not stated is one the source does not give: say so. Hotel amounts are pet fees, not room rates.

A no-match answer is an answer. Say what was tried, use its `did_you_mean` and `nearest` suggestions, and do not repeat the same call.

## Trip plans

When you make a plan with `dogpolicies_plan_trip`, give the traveler the plan as returned. Where the client supports it the tool draws a trip card; otherwise offer a shareable link: call it with `save` set to true and give the `trip_url` (a dogpolicies.com/trips/ page; the plan travels inside the link and nothing is stored).
