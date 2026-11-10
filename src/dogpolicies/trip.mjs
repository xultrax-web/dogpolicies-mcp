// The day-by-day plan behind dogpolicies_plan_trip (docs/DECISIONS.md, 107).
// Every slot is a real record from the graph with its rule, quote, source and
// verified date; where the graph has nothing for a slot, the slot is null and
// the day says why. Deterministic: the same graph and the same input give the
// same plan, byte for byte.

import { miles } from "../core/geo.mjs";
import { placeFreshness } from "./graph.mjs";
import {
  checkCount,
  checkWeight,
  feeArithmetic,
  feeLine,
} from "./vendor/match.mjs";
import { MAX_DAYS, addDays } from "./vendor/trip-link.mjs";

export { MAX_DAYS };

const ALLOWED = new Set(["yes", "yes_restricted"]);
const has = (p, tag) => (p.tags ?? []).includes(tag);
const round1 = (n) => Math.round(n * 10) / 10;

/** The reference a slot holds: the place, its rule with the quote, its source. */
export function placeRef(p, today, { distance, from, repeat } = {}) {
  const rules = p.rule_records ?? [];
  const rec =
    rules.find((r) => r.kind === "dogsAllowed" && r.quote) ??
    rules.find((r) => r.quote);
  return {
    id: p.id,
    name: p.name,
    kind: p.type,
    url: p.url,
    city: p.city ?? null,
    status: p.status,
    rule: p.answer,
    quote: rec?.quote ?? null,
    source_url: rec?.sourceUrl ?? p.source_urls?.[0] ?? null,
    source: rec?.sourcePublisher ?? p.managing_agency ?? null,
    verified_at: rec?.verifiedAt ?? p.verified_at,
    freshness: placeFreshness(p, today).state,
    confidence: p.confidence,
    ...(p.brand_policy ? { brand_policy: true } : {}),
    ...(p.osm ? { osm: true } : {}),
    distance_mi: distance ?? null,
    distance_from: from ?? null,
    ...(repeat ? { repeat: true } : {}),
  };
}

/**
 * The stay the plan is built on: the place, whether it fits the dog, and the
 * pet fee for the whole stay with its arithmetic. The numbers are the ones
 * dogpolicies_find_hotels returns for the same stay (the same matcher).
 */
export function stayPlan(p, r, today, { dogs, nights, weightLb }) {
  const feeFact = p.facts.fee?.value ?? null;
  const rec = (p.rule_records ?? []).find((x) => x.kind === "fee");
  const known = Boolean(r.fee?.known);
  const total = known ? r.fee.amount : null;
  const basis = feeFact?.basis?.replaceAll("_", " ") ?? null;
  const based_on = feeFact
    ? `The stay's pet fee policy: $${feeFact.amount}${basis ? ` ${basis}` : ""}${feeFact.capPerStay != null ? `, capped at $${feeFact.capPerStay} per stay` : ""}${rec?.sourcePublisher ? ` (${rec.sourcePublisher}, verified ${rec.verifiedAt})` : ""}. This is the pet fee only; DogPolicies has no room rates.`
    : "The policy states no pet fee. DogPolicies has no room rates.";
  return {
    ...placeRef(p, today),
    verdict: r.verdict,
    fee: {
      total,
      per_night:
        known && nights > 0 ? Math.round((total / nights) * 100) / 100 : null,
      is_maximum: Boolean(r.fee?.upTo),
      dogs,
      nights,
      line: feeLine(r.fee, { nights }),
      arithmetic: feeArithmetic(feeFact, r.fee, { dogs, nights }),
      based_on,
      basis: feeFact?.basis ?? null,
      amount_each: feeFact?.amount ?? null,
      quote: rec?.quote ?? null,
      source_url: rec?.sourceUrl ?? p.source_urls?.[0] ?? null,
      verified_at: rec?.verifiedAt ?? p.verified_at,
    },
    fit: {
      verdict: r.verdict,
      weight:
        weightLb == null ? "not_given" : checkWeight(p.facts, weightLb, dogs),
      weight_limit_lb: p.facts.weightLimitLb?.value ?? null,
      pet_count: checkCount(p.facts, dogs),
      max_pets: p.facts.maxPets?.value ?? null,
      reasons: r.reasons,
    },
  };
}

/** Candidates for one slot, best first: tier, then distance, then name and id. */
const sorted = (list) =>
  list.sort(
    (a, b) =>
      a.tier - b.tier ||
      a.d - b.d ||
      a.p.name.localeCompare(b.p.name) ||
      a.p.id.localeCompare(b.p.id),
  );

/** The slots' pools. found: [{ place }] near the destination, anchor: { lat, lon }. */
export function pools(found, anchor) {
  const ok = found
    .map((x) => x.place)
    .filter((p) => p.geo && ALLOWED.has(p.status))
    .map((p) => ({ p, d: round1(miles(anchor, p.geo)) }));
  const isWild = (p) => p.type === "beach" || p.type === "trail";
  const isPark = (p) => p.type === "park";
  const dogArea = (p) => has(p, "dog-parks") || has(p, "off-leash");
  const morning = [];
  const afternoon = [];
  const evening = [];
  for (const c of ok) {
    const { p } = c;
    if (isWild(p)) {
      morning.push({ ...c, tier: 0 });
      afternoon.push({ ...c, tier: 2 });
    } else if (isPark(p)) {
      // an open off-leash park is a morning run; a fenced dog park or any
      // dog-area park is an afternoon one; the rest of the parks fill in.
      morning.push({
        ...c,
        tier: has(p, "off-leash") && !has(p, "dog-parks") ? 1 : 2,
      });
      afternoon.push({ ...c, tier: dogArea(p) ? 0 : 1 });
    } else if (p.type === "restaurant") evening.push({ ...c, tier: 0 });
  }
  return {
    morning: sorted(morning),
    afternoon: sorted(afternoon),
    evening: sorted(evening),
  };
}

/**
 * One pick per day from a pool: unused places first; a repeat only when the
 * pool is spent, and then never the place already chosen for another slot of
 * the same day unless it is the only one.
 */
function assign(pool, days, used, dayUsed) {
  const out = [];
  for (let i = 0; i < days; i++) {
    let pick = pool.find((c) => !used.has(c.p.id));
    let repeat = false;
    if (!pick && pool.length) {
      const other = pool.filter((c) => !dayUsed[i].has(c.p.id));
      const from = other.length ? other : pool;
      pick = from[i % from.length];
      repeat = true;
    }
    if (pick) {
      used.add(pick.p.id);
      dayUsed[i].add(pick.p.id);
    }
    out.push(pick ? { ...pick, repeat } : null);
  }
  return out;
}

const REASONS = (radius, label, anchorWord) => ({
  morning: `No beach, trail or off-leash area in the data within ${radius} miles of ${label} states that dogs are allowed.`,
  afternoon: `No park or dog park in the data within ${radius} miles of ${label} states that dogs are allowed.`,
  evening: `No restaurant, patio or winery in the data within ${radius} miles of ${label} states that dogs are allowed, so dinner is left open rather than guessed (distances are from ${anchorWord}).`,
});

/**
 * The days of a trip. stay: the chosen stay's record (or null), found: the
 * places near the destination ([{ place }]), center: the destination's point.
 * Returns { days, dayCount, truncated }.
 */
export function planDays({
  found,
  stayPlace,
  stayRef,
  center,
  radius,
  label,
  nights,
  startDate,
  today,
}) {
  const dayCount = Math.min(nights, MAX_DAYS);
  const anchor = stayPlace?.geo ?? center;
  const from = stayPlace?.geo ? "stay" : "destination";
  const pool = pools(found, anchor);
  const used = new Set();
  const dayUsed = Array.from({ length: dayCount }, () => new Set());
  const picks = {
    morning: assign(pool.morning, dayCount, used, dayUsed),
    afternoon: assign(pool.afternoon, dayCount, used, dayUsed),
    evening: assign(pool.evening, dayCount, used, dayUsed),
  };
  const reasons = REASONS(
    radius,
    label,
    from === "stay" ? "the stay" : "the destination",
  );
  const days = [];
  for (let i = 0; i < dayCount; i++) {
    const day = {
      day: i + 1,
      date: startDate ? addDays(startDate, i) : null,
      stay: stayRef,
      missing: {},
    };
    for (const slot of ["morning", "afternoon", "evening"]) {
      const c = picks[slot][i];
      day[slot] = c
        ? placeRef(c.p, today, { distance: c.d, from, repeat: c.repeat })
        : null;
      if (!c) day.missing[slot] = reasons[slot];
    }
    if (!stayRef)
      day.missing.stay =
        "No stay in the data fits this dog and these criteria near the destination.";
    days.push(day);
  }
  return { days, dayCount, truncated: nights > dayCount };
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
/** "Tue Dec 1" for an ISO date. */
export function dateWords(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${WEEKDAY[d.getUTCDay()]} ${MONTH[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

const flat = (s) => String(s).replace(/\s+/g, " ").trim();
const KIND = {
  beach: "beach",
  trail: "trail",
  park: "park",
  restaurant: "eats",
  lodging: "hotel",
  campground: "campground",
  cabins: "cabin",
};

function slotLines(label, ref, why) {
  if (!ref) return [`- ${label}: none. ${why}`];
  const dist =
    ref.distance_mi != null
      ? ` · ${ref.distance_mi} mi from the ${ref.distance_from}`
      : "";
  return [
    `- ${label}: [${ref.name}](${ref.url}) (${KIND[ref.kind] ?? ref.kind})${dist}${ref.repeat ? " · repeated: the data has no other place for this slot" : ""}`,
    `  Rule: ${flat(ref.rule)}`,
    ...(ref.quote ? [`  Quote: "${flat(ref.quote)}"`] : []),
    `  ${ref.source_url ? `Source: ${ref.source_url} · ` : ""}verified ${ref.verified_at}${ref.freshness !== "fresh" ? ` (${ref.freshness}: confirm before you go)` : ""}`,
  ];
}

/** The plan as a document an assistant can hand over. */
export function planMarkdown({ days, planStay, notes, url }) {
  if (!days.length) return [];
  const lines = ["## The plan, day by day", ""];
  if (planStay) {
    const f = planStay.fee;
    lines.push(
      `Stay: [${planStay.name}](${planStay.url}) (${KIND[planStay.kind] ?? planStay.kind}) · ${planStay.fit.verdict === "match" ? "fits your dog" : planStay.fit.verdict === "possible" ? "call to confirm" : planStay.fit.verdict}`,
      `Pet fee for the stay: ${f.total != null ? `${f.is_maximum ? "up to " : ""}$${f.total}${f.per_night != null && f.total > 0 ? ` ($${f.per_night} a night)` : ""}` : "not settled by the policy"}. ${f.arithmetic}`,
      `${f.based_on}${f.source_url ? ` Source: ${f.source_url}` : ""}`,
      `Weight: ${planStay.fit.weight}${planStay.fit.weight_limit_lb != null ? ` (limit ${planStay.fit.weight_limit_lb} lb)` : ""} · number of dogs: ${planStay.fit.pet_count}${planStay.fit.max_pets != null ? ` (limit ${planStay.fit.max_pets})` : ""}`,
      ...(planStay.fit.reasons.length
        ? [`Notes: ${planStay.fit.reasons.join(" ")}`]
        : []),
      "",
    );
  } else
    lines.push("No stay in the data fits this dog and these criteria.", "");
  for (const d of days) {
    lines.push(
      `### Day ${d.day}${d.date ? ` · ${dateWords(d.date)}` : ""}`,
      "",
      ...slotLines("Morning", d.morning, d.missing.morning),
      ...slotLines("Afternoon", d.afternoon, d.missing.afternoon),
      ...slotLines("Evening", d.evening, d.missing.evening),
      "",
    );
  }
  for (const n of notes) lines.push(n);
  lines.push(
    url
      ? `Trip page (the plan is inside the link; nothing is stored): ${url}`
      : "To keep this plan as a link, call again with save=true.",
    "",
  );
  return lines;
}
