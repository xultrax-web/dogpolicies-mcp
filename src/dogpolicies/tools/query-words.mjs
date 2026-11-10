// A free-text query read as a person writes it: "dog friendly hotels in
// Carmel", "beaches near Santa Cruz that allow dogs", "Lake Tahoe cabins with
// my dog". The kind words become a filter, the dog words and the connectives
// (near, in, around, at) drop out, and what is left is the place's name.
// The website's /search/ reads its box with this file too (src/lib/place-names.mjs),
// so it must stay free of anything a browser cannot run.

import { miles } from "../../core/geo.mjs";
import { KIND_SYNONYMS, keyOf, makeTable, singular } from "./tolerant.mjs";

/** How far from a resolved town or neighborhood a place still counts as in it. */
export const TOWN_RADIUS_MILES = 15;

const lower = (s) => (s ?? "").toLowerCase();

/** Words in a place's own text: name, city, county, brand. */
export const placeText = (p) =>
  lower(`${p.name} ${p.city ?? ""} ${p.county ?? ""} ${p.brand ?? ""}`);

/** Every word of `name` starts a word of the place's text ("reno" is Reno, not Moreno). */
export const hasWords = (p, name) => {
  const words = keyOf(placeText(p)).split(" ");
  return name.split(" ").every((w) => words.some((x) => x.startsWith(w)));
};

/**
 * Whether a place belongs to a town, area, region or county the gazetteer
 * resolved (names.mjs): an area or region by membership, a county by name and
 * state, a town, neighborhood or airport by its city or within
 * TOWN_RADIUS_MILES of its center.
 */
export const inTown = (town) => (p) =>
  town.kind === "area"
    ? p.area_id === town.id
    : town.kind === "region"
      ? p.regionId === town.id
      : town.kind === "county"
        ? lower(p.county) === lower(town.name.replace(/ county$/i, "")) &&
          (!town.state || p.state === town.state)
        : lower(p.city) === lower(town.name) ||
          Boolean(p.geo && miles(town, p.geo) <= TOWN_RADIUS_MILES);

const KINDS = [
  "lodging",
  "campground",
  "cabins",
  "beach",
  "park",
  "trail",
  "restaurant",
  "rest_area",
  "stop",
];

// Words that are also parts of names or everyday English: fine as a tool's
// `type`, too risky to pull out of a sentence.
const NOT_IN_SENTENCES = new Set(
  [
    "bar",
    "walk",
    "walking",
    "path",
    "room",
    "suite",
    "overnight",
    "sand",
    "shore",
    "gas",
    "fuel",
    "drink",
    "drinks",
    "eat",
    "eating",
    "preserve",
    "camp out",
    "service area",
    "up",
    "down",
    "wine",
    "coffee",
    "lunch",
    "dinner",
    "brunch",
  ].map((w) => singular(keyOf(w))),
);

const KIND_WORDS = (() => {
  const table = makeTable(KINDS, KIND_SYNONYMS);
  for (const k of [...table.keys()])
    if (NOT_IN_SENTENCES.has(k)) table.delete(k);
  return table;
})();
const LONGEST = Math.max(
  ...[...KIND_WORDS.keys()].map((k) => k.split(" ").length),
);

// What a kind word stands for when it is read out of a sentence: cabins are
// also lodging and cabin-resort campgrounds in the data.
const EXPAND = { cabins: ["cabins", "lodging", "campground"] };

const DOG = new Set(["dog", "dogs", "pet", "pets", "puppy", "pup", "doggy"]);
const QUESTION = new Set([
  "can",
  "could",
  "may",
  "will",
  "would",
  "should",
  "is",
  "are",
  "does",
  "do",
  "did",
]);
const CONNECTIVES = new Set(
  (
    "near in around at by for of the a an to from with my our your and or " +
    "that which who can i we you bring take takes allow allows allowed " +
    "friendly welcome welcomes accept accepts let lets ok okay where what " +
    "are is there any some best good nice top great places place spots spot " +
    "things thing do does nearby close within me find show list looking " +
    "want need mile miles"
  ).split(" "),
);

/** Words too common in names to match a place on their own. */
export const GENERIC = new Set(
  (
    "san santa los las lake mount mountain mountains mt state county city " +
    "national north south east west point bay valley river creek park beach " +
    "trail resort hotel inn motel the and"
  ).split(" "),
);

/**
 * @returns {{ kinds: string[], name: string, dogs: boolean, offLeash: boolean, changed: boolean }}
 *   kinds: the place types the words name (cabins also lodging and campground);
 *   name: what is left, to match as a place, town or neighborhood;
 *   dogs: the words ask for places that allow dogs (never for a question about one place).
 */
export function parseQuery(text) {
  // "off leash" is a rule, not a name: it becomes the off_leash filter
  const lowered = keyOf(text);
  const offLeash = /(^| )(off leash|offleash|leash free|leashfree)( |$)/.test(
    lowered,
  );
  const words = lowered
    .replace(/(^| )(off leash|offleash|leash free|leashfree)(?= |$)/g, " ")
    .split(" ")
    .filter(Boolean);
  const kinds = [];
  const rest = [];
  let sawDog = false;
  for (let i = 0; i < words.length;) {
    let hit = null;
    for (let n = Math.min(LONGEST, words.length - i); n >= 1 && !hit; n--) {
      const kind = KIND_WORDS.get(singular(words.slice(i, i + n).join(" ")));
      if (kind) hit = [kind, n];
    }
    if (hit) {
      for (const k of EXPAND[hit[0]] ?? [hit[0]])
        if (!kinds.includes(k)) kinds.push(k);
      i += hit[1];
      continue;
    }
    const w = words[i++];
    if (DOG.has(w)) sawDog = true;
    else if (!CONNECTIVES.has(w)) rest.push(w);
  }
  const name = rest.join(" ");
  return {
    offLeash,
    kinds,
    name,
    dogs: sawDog && !QUESTION.has(words[0]),
    changed: kinds.length > 0 || sawDog || offLeash || name !== words.join(" "),
  };
}
