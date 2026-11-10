// Input a model will plausibly send, read before it is checked. A tool's
// schema still lists the canonical values (the JSON Schema a client reads is
// the schema's output side, and z.preprocess lets that side through), but the
// words people use for them are mapped first: "hotel" is lodging, "NB" is
// north, "Motel 6" is motel-6, "yes" is true. A value that maps to nothing
// fails the schema as before; the registry turns that failure into a
// bad_input answer that lists what is accepted (core/server.mjs, decision 96).
// Which values were mapped is reported by the registry in resolved_from.

import * as z from "zod/v4";

/** "Rest-Area", "rest_area" and " REST AREA " all become "rest area"; accents and punctuation go. */
export const keyOf = (s) =>
  String(s)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const singularWord = (w) =>
  w.length < 4 || /(ss|us|is)$/.test(w)
    ? w
    : w
        .replace(/ies$/, "y")
        .replace(/(ch|sh|x|ss)es$/, "$1")
        .replace(/s$/, "");
/** "beaches" -> "beach", "dog parks" -> "dog park", "hikes" -> "hike". */
export const singular = (k) => k.split(" ").map(singularWord).join(" ");
const norm2 = (s) => singular(keyOf(s));

// Words that only say "of the kind I mean": dropped when the whole phrase is not known.
const FILLER = new Set([
  "the",
  "a",
  "an",
  "some",
  "any",
  "best",
  "good",
  "great",
  "nearby",
  "near",
  "pet",
  "friendly",
  "dog",
  "dogs",
  "going",
  "heading",
  "driving",
  "traveling",
  "travelling",
  "headed",
  "toward",
  "towards",
  "bound",
  "on",
  "in",
  "for",
  "with",
  "my",
  "to",
  "of",
]);

/** A lookup from many phrasings to one canonical value. `synonyms` is {canonical: [phrase, ...]}. */
export function makeTable(values, synonyms = {}, extra = []) {
  const map = new Map();
  const add = (phrase, value) => {
    const k = norm2(phrase);
    if (k && !map.has(k)) map.set(k, value);
  };
  for (const v of values) {
    add(v, v);
    for (const phrase of synonyms[v] ?? []) add(phrase, v);
  }
  for (const [phrase, v] of extra) add(phrase, v);
  return map;
}

/** The canonical value for a phrase, or undefined. Tries the phrase, then without filler words. */
export function lookup(map, asked) {
  if (typeof asked !== "string" && typeof asked !== "number") return undefined;
  const k = norm2(asked);
  if (!k) return undefined;
  if (map.has(k)) return map.get(k);
  const words = k.split(" ");
  const kept = words.filter((w) => !FILLER.has(w));
  if (kept.length && kept.length < words.length && map.has(kept.join(" ")))
    return map.get(kept.join(" "));
  // one word of a phrase that names a kind ("patio restaurant"): only when the phrase has one kind
  const hits = new Set(
    kept.map((w) => map.get(w)).filter((v) => v !== undefined),
  );
  if (kept.length > 1 && hits.size === 1) return [...hits][0];
  return undefined;
}

/** Splits "hotels, restaurants and beaches" / "hotel/motel" into phrases. */
export const splitList = (s) =>
  String(s)
    .split(/\s*(?:,|;|\/|\||&|\band\b|\bor\b|\+)\s*/i)
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * One of `values`, however it is worded. Unknown words pass through unchanged
 * and fail the enum (the registry answers bad_input with the accepted values).
 */
export function choice(values, synonyms = {}, extra = [], def) {
  const table = makeTable(values, synonyms, extra);
  const inner = z.enum(values);
  return z.preprocess(
    (v) => {
      if (Array.isArray(v) && v.length === 1) v = v[0];
      return lookup(table, v) ?? v;
    },
    def === undefined ? inner : inner.default(def),
  );
}

/** A list of `values`: an array, one string, or a comma/"and" separated string; mapped and de-duplicated. */
export function choiceList(values, synonyms = {}, extra = [], def) {
  const table = makeTable(values, synonyms, extra);
  return z.preprocess(
    (v) => {
      if (v === undefined || v === null) return v;
      const raw = Array.isArray(v) ? v : [v];
      const out = [];
      for (const item of raw) {
        if (typeof item !== "string") {
          out.push(item);
          continue;
        }
        // the whole phrase first ("rest area", "dog park"), then its parts
        const whole = lookup(table, item);
        const parts =
          whole !== undefined
            ? [whole]
            : splitList(item).map((p) => lookup(table, p) ?? p);
        for (const p of parts) if (!out.includes(p)) out.push(p);
      }
      return out;
    },
    def === undefined
      ? z.array(z.enum(values)).min(1)
      : z.array(z.enum(values)).min(1).default(def),
  );
}

/** true or false from "yes", "no", "1", "0", "on", "off", "Y", "N". Anything else fails the schema. */
export function flag(def) {
  return z.preprocess(
    (v) => {
      if (typeof v === "number") return v === 1 ? true : v === 0 ? false : v;
      if (typeof v !== "string") return v;
      const k = keyOf(v);
      if (["true", "yes", "y", "1", "on", "t"].includes(k)) return true;
      if (["false", "no", "n", "0", "off", "f"].includes(k)) return false;
      return v;
    },
    def === undefined ? z.boolean() : z.boolean().default(def),
  );
}

/** A number sent as a string ("25", "25 miles", "$150", "1,000") read as a number. */
export function readNumber(v) {
  if (typeof v !== "string") return v;
  const m = v.replace(/[,$\s]/g, "").match(/^-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : v;
}

/** A page size is a ceiling, not a contract: 100 means "as many as you have", so it is capped, not refused. */
export function pageSize({ max, fallback }) {
  return z.preprocess((v) => {
    const n = readNumber(v);
    return typeof n === "number" && Number.isFinite(n)
      ? Math.min(max, Math.max(1, Math.round(n)))
      : v;
  }, z.number().int().min(1).max(max).default(fallback));
}

/** {lat, lon}: "latitude", "lng", "long", "longitude", or "36.6,-121.9" as one string. */
export function pointInput(v) {
  if (typeof v === "string") {
    const m = v.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/);
    return m ? { lat: Number(m[1]), lon: Number(m[2]) } : v;
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return v;
  const out = {};
  const rename = {
    latitude: "lat",
    lng: "lon",
    long: "lon",
    longitude: "lon",
    radius: "radius_miles",
    radius_mi: "radius_miles",
    miles: "radius_miles",
  };
  for (const [k, val] of Object.entries(v)) {
    const to = rename[k.toLowerCase()] ?? k;
    out[to] ??= to === "lat" || to === "lon" ? readNumber(val) : val;
  }
  return out;
}

/** A date as YYYY-MM-DD from "2026/9/1", "2026-09", "2026-09-01T10:00:00Z". */
export function dateInput(v) {
  if (typeof v !== "string") return v;
  const m = v
    .trim()
    .match(/^(\d{4})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?(?:[T\s].*)?$/);
  if (!m) return v;
  const pad = (n) => String(n).padStart(2, "0");
  return `${m[1]}-${pad(m[2])}-${pad(m[3] ?? 1)}`;
}

/**
 * An id the data names (region, area, strip, route, brand), however it is
 * said: the id, its name, "Lake Tahoe", "lake_tahoe", "the Grapevine". `names`
 * is {id: [name or alias, ...]}; a phrase that is contained in exactly one id's
 * words also resolves to it.
 */
export function idLookup(ids, names = {}, extra = []) {
  const table = makeTable(ids, names, extra);
  const words = new Map(ids.map((id) => [id, new Set(norm2(id).split(" "))]));
  for (const id of ids)
    for (const n of names[id] ?? [])
      for (const w of norm2(n).split(" ")) words.get(id).add(w);
  return (asked) => {
    const direct = lookup(table, asked);
    if (direct !== undefined) return direct;
    if (typeof asked !== "string") return undefined;
    const ws = norm2(asked)
      .split(" ")
      .filter((w) => w && !FILLER.has(w));
    if (!ws.length) return undefined;
    const hit = ids.filter((id) => ws.every((w) => words.get(id).has(w)));
    return hit.length === 1 ? hit[0] : undefined;
  };
}

/** An id enum read through `lookup`; a phrase that is no id fails the enum. */
export function idChoice(ids, names = {}, extra = [], def) {
  const find = idLookup(ids, names, extra);
  const inner = z.enum(ids);
  return z.preprocess(
    (v) => find(v) ?? v,
    def === undefined ? inner : inner.default(def),
  );
}

/** A free-text id field (area) that is mapped to the id when it names one, and left alone when not. */
export function idText(ids, names, inner, extra = []) {
  const find = idLookup(ids, names, extra);
  return z.preprocess((v) => find(v) ?? v, inner);
}

// ---- The words ----

export const KIND_SYNONYMS = {
  lodging: [
    "hotel",
    "motel",
    "inn",
    "stay",
    "lodge",
    "lodgings",
    "accommodation",
    "accomodation",
    "resort",
    "hostel",
    "b and b",
    "bnb",
    "bed and breakfast",
    "place to stay",
    "room",
    "suite",
    "overnight",
    "hotel motel",
  ],
  campground: [
    "camp ground",
    "camping",
    "camp",
    "campsite",
    "camp site",
    "rv park",
    "rv",
    "rv resort",
    "rv site",
    "rv campground",
    "tent camping",
    "camp out",
  ],
  cabins: [
    "cabin",
    "cabin rental",
    "cottage",
    "chalet",
    "cabin resort",
    "log cabin",
  ],
  beach: ["dog beach", "off leash beach", "shore", "seashore", "sand"],
  park: [
    "dog park",
    "dog_park",
    "dogpark",
    "off leash park",
    "off leash area",
    "dog run",
    "dog area",
    "state park",
    "national park",
    "regional park",
    "city park",
    "county park",
    "open space",
    "preserve",
    "nature preserve",
    "recreation area",
    "green space",
    "leash free area",
    "leash free park",
  ],
  trail: [
    "hike",
    "hiking",
    "hiking trail",
    "walk",
    "walking",
    "walking trail",
    "nature trail",
    "trailhead",
    "path",
    "trek",
    "backpacking",
  ],
  restaurant: [
    "patio",
    "food",
    "dining",
    "eat",
    "eating",
    "cafe",
    "coffee",
    "coffee shop",
    "bar",
    "pub",
    "brewery",
    "taproom",
    "winery",
    "wine",
    "wine bar",
    "wine tasting",
    "tasting room",
    "vineyard",
    "outdoor dining",
    "dog friendly patio",
    "restaurant patio",
    "patio dining",
    "brunch",
    "lunch",
    "dinner",
    "bistro",
    "diner",
    "bakery",
    "place to eat",
    "drink",
    "drinks",
    "brew pub",
    "brewpub",
  ],
  rest_area: [
    "rest area",
    "rest stop",
    "restarea",
    "roadside rest",
    "roadside rest area",
    "safety roadside rest area",
    "service area",
    "vista point",
  ],
  stop: [
    "travel stop",
    "truck stop",
    "gas",
    "gas station",
    "fuel",
    "service station",
    "roadside stop",
    "travel center",
    "travel plaza",
    "rest and fuel",
  ],
};
export const KINDS = [
  "rest_area",
  "stop",
  "lodging",
  "campground",
  "cabins",
  "park",
  "beach",
  "trail",
  "restaurant",
];

export const DIRECTION_SYNONYMS = {
  north: [
    "n",
    "nb",
    "northbound",
    "north bound",
    "northward",
    "northwards",
    "up",
  ],
  south: [
    "s",
    "sb",
    "southbound",
    "south bound",
    "southward",
    "southwards",
    "down",
  ],
  east: ["e", "eb", "eastbound", "east bound", "eastward", "eastwards"],
  west: ["w", "wb", "westbound", "west bound", "westward", "westwards"],
};

export const STATE_SYNONYMS = {
  CA: ["california", "calif", "cal", "cali"],
  NV: ["nevada", "nev"],
};

export const FORMAT_SYNONYMS = {
  markdown: ["md", "text", "plain", "readable", "human", "prose", "txt"],
  json: ["structured", "data", "object"],
};

export const OUTCOME_SYNONYMS = {
  confirmed: ["confirm", "verified", "verify", "checked", "ok", "unchanged"],
  changed: [
    "change",
    "changes",
    "rule change",
    "updated",
    "update",
    "modified",
  ],
  source_gone: [
    "gone",
    "source gone",
    "removed",
    "missing",
    "404",
    "dead link",
  ],
  blocked: ["block", "unreadable", "bot wall"],
  disputed: ["dispute", "contested", "disagreed"],
};

// Region, area, strip and brand names and the shorthand people use for them.
export const REGION_NAMES = {
  "north-coast": ["north coast", "redwood coast", "humboldt coast"],
  "shasta-cascade": ["shasta", "cascade", "northern california", "far north"],
  "gold-country": ["gold country"],
  "high-sierra": [
    "sierra",
    "sierras",
    "sierra nevada",
    "eastern sierra",
    "mammoth",
  ],
  "bay-area": ["bay area", "san francisco bay area", "sf bay area", "the bay"],
  "central-coast": ["central coast"],
  "central-valley": ["central valley", "san joaquin valley"],
  "inland-empire-deserts": [
    "inland empire",
    "deserts",
    "desert",
    "palm springs",
    "inland empire and deserts",
  ],
  "los-angeles": [
    "la",
    "l a",
    "los angeles county",
    "la county",
    "greater los angeles",
  ],
  "orange-county": ["oc", "orange county"],
  "san-diego": ["san diego county", "san diego"],
  "reno-tahoe-nevada": ["reno", "reno tahoe", "carson city", "nevada tahoe"],
  "las-vegas-southern-nevada": [
    "las vegas",
    "vegas",
    "southern nevada",
    "clark county",
  ],
  "northern-central-nevada": [
    "northern nevada",
    "central nevada",
    "elko",
    "ely",
  ],
};
export const AREA_NAMES = {
  "san-francisco": ["sf", "the city"],
  "east-bay": ["eastbay", "east san francisco bay"],
  peninsula: ["the peninsula", "san francisco peninsula", "mid peninsula"],
  "south-bay": ["southbay", "silicon valley"],
  "north-bay": ["northbay", "marin sonoma napa"],
  "lake-tahoe": [
    "tahoe",
    "lake tahoe area",
    "tahoe basin",
    "south lake tahoe",
    "north lake tahoe",
  ],
  "big-sur": ["bigsur"],
  "mendocino-coast": ["mendocino", "mendocino county coast"],
  yosemite: ["yosemite national park", "yosemite valley"],
  "death-valley": ["death valley national park"],
};
export const STRIP_NAMES = {
  sandiego: ["san diego"],
  "orange-la": [
    "orange la",
    "orange county",
    "los angeles",
    "la",
    "orange county los angeles",
  ],
  grapevine: ["the grapevine", "tejon pass", "tejon"],
  "kern-westside": ["kern", "westside kern", "kern westside"],
  westside: ["west side"],
  delta: ["stockton", "san joaquin delta"],
  sacramento: ["sac", "sacramento valley"],
  valley: ["central valley", "san joaquin valley"],
  tehama: ["red bluff", "tehama county"],
  shasta: ["redding", "mount shasta", "mt shasta"],
  siskiyou: ["siskiyou pass", "oregon border"],
};
