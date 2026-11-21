// Places a dog stays overnight, and the words for them: a hotel's room, a
// campground's site. Mirrors STAY in src/lib/format.mjs for the vendored matcher.
export const STAY = {
  lodging: { place: "hotel", unit: "room" },
  campground: { place: "campground", unit: "site" },
  cabins: { place: "resort", unit: "cabin" },
};
export const isStay = (p) => Object.hasOwn(STAY, p.type);

// Whether a place is of a kind: its own type, or one of the other kinds it also
// is (alsoTypes on the record: a campground that also rents cabins). Every
// filter by kind, on the site and in the tools, asks this.
export const isKind = (p, kind) =>
  p.type === kind || (p.alsoTypes?.includes(kind) ?? false);
export const isAnyKind = (p, kinds) => kinds.some((k) => isKind(p, k));

export const STATE_NAME = { CA: "California", NV: "Nevada" };
export const STATES = ["CA", "NV"];

/** "Monterey County". Carson City is a consolidated city, so it has no "County". */
export const countyName = (county) =>
  county === "Carson City" ? county : `${county} County`;

/** City, then county, for a location line; Carson City is named once. */
export const cityCounty = (city, county) => [
  ...new Set([city, county && countyName(county)].filter(Boolean)),
];
