// Places outside California and Nevada, said plainly (proposed decision 124).
// A question about Portland, Oregon, Phoenix, Lisbon or Tokyo is an answer:
// outcome no_match, code out_of_coverage, the place named, and for a place near
// the state line the closest covered towns. A covered name always wins: the
// gazetteer is consulted only after the data's own towns, areas, regions,
// airports and neighborhoods match nothing exactly, and the real California
// and Nevada towns that share a name with a place elsewhere (Dublin,
// Georgetown, Oregon House, Ashland) are never read as out of coverage.
// Off-topic questions (flights, car rentals, weather) get the same kind of
// answer with code off_topic. No network: everything here is static.

import { miles } from "../../core/geo.mjs";
import { nearestTowns, resolveTown } from "./common.mjs";
import { keyOf } from "./tolerant.mjs";

// U.S. states and territories outside coverage: name, postal code, capital,
// largest cities. A two-letter code is read only after a city name ("Portland,
// OR") or where it cannot be an English word or a covered shorthand.
const STATES = [
  ["Alabama", "AL", "Montgomery", "Birmingham, Huntsville, Mobile"],
  ["Alaska", "AK", "Juneau", "Anchorage, Fairbanks"],
  ["Arizona", "AZ", "Phoenix", "Tucson, Mesa, Scottsdale, Tempe, Chandler, Flagstaff, Sedona, Yuma, Lake Havasu, Lake Havasu City, Bullhead City, Kingman, Parker, Quartzsite, Ehrenberg, Page"],
  ["Arkansas", "AR", "Little Rock", "Fayetteville, Fort Smith"],
  ["Colorado", "CO", "Denver", "Colorado Springs, Aurora, Boulder, Fort Collins, Aspen, Vail"],
  ["Connecticut", "CT", "Hartford", "Bridgeport, New Haven, Stamford"],
  ["Delaware", "DE", "Dover", "Wilmington"],
  ["District of Columbia", "DC", "Washington DC", "Washington D C"],
  ["Florida", "FL", "Tallahassee", "Jacksonville, Miami, Tampa, Orlando, Key West, Fort Lauderdale"],
  ["Georgia", "GA", "Atlanta", "Savannah, Augusta"],
  ["Hawaii", "HI", "Honolulu", "Maui, Kauai, Oahu, Kona, Hilo, Waikiki"],
  ["Idaho", "ID", "Boise", "Twin Falls, Idaho Falls, Coeur d'Alene, Sun Valley, Pocatello"],
  ["Illinois", "IL", "Springfield", "Chicago"],
  ["Indiana", "IN", "Indianapolis", "Fort Wayne"],
  ["Iowa", "IA", "Des Moines", "Cedar Rapids"],
  ["Kansas", "KS", "Topeka", "Wichita"],
  ["Kentucky", "KY", "Frankfort", "Louisville, Lexington"],
  ["Louisiana", "LA", "Baton Rouge", "New Orleans"],
  ["Maine", "ME", "Augusta", "Portland Maine, Bar Harbor"],
  ["Maryland", "MD", "Annapolis", "Baltimore"],
  ["Massachusetts", "MA", "Boston", "Worcester, Cape Cod"],
  ["Michigan", "MI", "Lansing", "Detroit, Grand Rapids"],
  ["Minnesota", "MN", "Saint Paul", "Minneapolis, St Paul"],
  ["Mississippi", "MS", "Jackson Mississippi", "Gulfport"],
  ["Missouri", "MO", "Jefferson City", "Kansas City, St Louis, Saint Louis, Branson"],
  ["Montana", "MT", "Helena", "Billings, Missoula, Bozeman"],
  ["Nebraska", "NE", "Lincoln Nebraska", "Omaha"],
  ["New Hampshire", "NH", "Concord New Hampshire", "Manchester New Hampshire"],
  ["New Jersey", "NJ", "Trenton", "Newark New Jersey, Jersey City, Atlantic City"],
  ["New Mexico", "NM", "Santa Fe", "Albuquerque, Las Cruces, Taos"],
  ["New York", "NY", "Albany New York", "New York City, NYC, Manhattan, Brooklyn, Buffalo, Rochester"],
  ["North Carolina", "NC", "Raleigh", "Charlotte, Asheville"],
  ["North Dakota", "ND", "Bismarck", "Fargo"],
  ["Ohio", "OH", "Columbus", "Cleveland, Cincinnati"],
  ["Oklahoma", "OK", "Oklahoma City", "Tulsa"],
  ["Oregon", "OR", "Salem", "Portland, Eugene, Bend, Medford, Grants Pass, Klamath Falls, Brookings, Gold Beach, Crater Lake"],
  ["Pennsylvania", "PA", "Harrisburg", "Philadelphia, Pittsburgh"],
  ["Rhode Island", "RI", "Providence", "Newport Rhode Island"],
  ["South Carolina", "SC", "Columbia South Carolina", "Charleston, Myrtle Beach"],
  ["South Dakota", "SD", "Pierre", "Sioux Falls, Rapid City"],
  ["Tennessee", "TN", "Nashville", "Memphis, Knoxville, Chattanooga"],
  ["Texas", "TX", "Austin", "Houston, San Antonio, Dallas, Fort Worth, El Paso"],
  ["Utah", "UT", "Salt Lake City", "St George, Saint George, Cedar City, Moab, Park City, Zion, Zion National Park, Bryce Canyon, Wendover, Mexican Hat"],
  ["Vermont", "VT", "Montpelier", "Burlington"],
  ["Virginia", "VA", "Richmond Virginia", "Virginia Beach, Norfolk, Arlington Virginia"],
  ["Washington", "WA", "Olympia", "Seattle, Spokane, Tacoma, Vancouver Washington, Washington State"],
  ["West Virginia", "WV", "Charleston West Virginia", ""],
  ["Wisconsin", "WI", "Madison", "Milwaukee"],
  ["Wyoming", "WY", "Cheyenne", "Jackson Hole, Yellowstone, Grand Teton"],
  ["Puerto Rico", "PR", "San Juan Puerto Rico", ""],
];

// Two-letter codes that are words, or shorthand for covered places: never read on their own.
const CODE_NEEDS_CITY = new Set(["AL", "CO", "DE", "HI", "ID", "IN", "LA", "MA", "ME", "MT", "OH", "OK", "OR", "PA", "SC", "SD", "NE"]);

// Canada and Mexico: provinces, states and the cities people ask about.
const COUNTRIES = {
  Canada: "British Columbia, BC, Alberta, Saskatchewan, Manitoba, Ontario Canada, Quebec, New Brunswick, Nova Scotia, Prince Edward Island, Newfoundland, Yukon, Northwest Territories, Nunavut, Vancouver, Victoria, Whistler, Calgary, Edmonton, Banff, Toronto, Montreal, Ottawa, Quebec City, Winnipeg, Halifax, Kelowna",
  Mexico: "Baja California, Baja, Baja California Sur, Sonora, Tijuana, Rosarito, Ensenada, Mexicali, San Felipe, Los Algodones, Algodones, San Luis Rio Colorado, Nogales, Cabo San Lucas, Cabo, Los Cabos, La Paz, Puerto Penasco, Rocky Point, Mexico City, Cancun, Tulum, Playa del Carmen, Puerto Vallarta, Guadalajara, Oaxaca, Monterrey, Mazatlan, San Miguel de Allende",
  // The world cities travelers ask about most, by country.
  "United Kingdom": "UK, England, Scotland, Wales, London, Edinburgh, Glasgow, Liverpool, Oxford, Bath England",
  Ireland: "Dublin Ireland",
  France: "Paris, Nice France, Lyon, Marseille, Bordeaux, Provence",
  Spain: "Madrid, Barcelona, Seville, Valencia Spain, Malaga, Ibiza, Mallorca",
  Portugal: "Lisbon, Porto, Lisboa, Algarve",
  Italy: "Rome, Milan, Venice Italy, Florence, Naples, Amalfi, Tuscany, Sicily",
  Germany: "Berlin, Munich, Frankfurt, Hamburg, Cologne",
  Netherlands: "Amsterdam, Holland, Rotterdam",
  Belgium: "Brussels, Bruges",
  Switzerland: "Zurich, Geneva, Zermatt, Lucerne",
  Austria: "Vienna, Salzburg",
  "Czech Republic": "Prague, Czechia",
  Hungary: "Budapest",
  Poland: "Krakow, Warsaw",
  Denmark: "Copenhagen",
  Sweden: "Stockholm",
  Norway: "Oslo",
  Finland: "Helsinki",
  Iceland: "Reykjavik",
  Greece: "Athens, Santorini, Mykonos, Crete",
  Croatia: "Dubrovnik, Split Croatia",
  Turkey: "Istanbul, Turkiye",
  Russia: "Moscow, Saint Petersburg Russia",
  Japan: "Tokyo, Kyoto, Osaka, Hokkaido, Okinawa",
  "South Korea": "Korea, Seoul, Busan",
  China: "Beijing, Shanghai, Hong Kong",
  Taiwan: "Taipei",
  Singapore: "",
  Thailand: "Bangkok, Phuket, Chiang Mai",
  Vietnam: "Hanoi, Ho Chi Minh City, Saigon",
  Indonesia: "Bali, Jakarta",
  Malaysia: "Kuala Lumpur",
  Philippines: "Manila",
  India: "New Delhi, Mumbai, Goa",
  "United Arab Emirates": "UAE, Dubai, Abu Dhabi",
  Qatar: "Doha",
  Israel: "Tel Aviv, Jerusalem",
  Lebanon: "Beirut",
  Egypt: "Cairo",
  Morocco: "Marrakech, Casablanca",
  "South Africa": "Cape Town, Johannesburg",
  Kenya: "Nairobi",
  Australia: "Sydney, Melbourne, Brisbane, Perth",
  "New Zealand": "Auckland, Queenstown, Wellington",
  Brazil: "Rio de Janeiro, Sao Paulo",
  Argentina: "Buenos Aires",
  Peru: "Lima, Cusco, Machu Picchu",
  Chile: "Santiago Chile",
  Colombia: "Bogota, Medellin, Cartagena",
  "Costa Rica": "San Jose Costa Rica",
  Cuba: "Havana",
  Bahamas: "Nassau",
  Jamaica: "",
  "Dominican Republic": "Punta Cana",
  Panama: "Panama City",
};

// Real California and Nevada towns whose names also belong to places
// elsewhere; the data may hold no record for them yet, but they are covered.
const COVERED_HOMONYMS = new Set([
  "georgetown", "oregon house", "dublin", "portola", "ashland", "klamath",
  "lincoln", "jackson", "albany", "newark", "concord", "richmond", "columbia",
  "manchester", "ontario", "washington", "delhi", "lodi", "florence",
  "valencia", "venice", "tecate", "carlsbad", "avalon", "lakeview",
]);

// Approximate centers (degrees, two decimals) of the places near the state
// line, from the U.S. Geological Survey's Geographic Names Information System
// (U.S. places) and GeoNames (Mexico): used only to rank the closest covered
// towns, never to make a rule.
const BORDER = {
  "medford": [42.33, -122.87],
  "grants pass": [42.44, -123.33],
  "klamath falls": [42.22, -121.78],
  "brookings": [42.05, -124.28],
  "gold beach": [42.41, -124.42],
  "crater lake": [42.94, -122.11],
  "yuma": [32.69, -114.63],
  "lake havasu city": [34.48, -114.32],
  "bullhead city": [35.15, -114.57],
  "kingman": [35.19, -114.05],
  "parker": [34.15, -114.29],
  "quartzsite": [33.66, -114.23],
  "ehrenberg": [33.6, -114.53],
  "st george": [37.1, -113.58],
  "saint george": [37.1, -113.58],
  "cedar city": [37.68, -113.06],
  "zion": [37.3, -113.03],
  "zion national park": [37.3, -113.03],
  "wendover": [40.74, -114.04],
  "twin falls": [42.56, -114.46],
  "tijuana": [32.53, -117.02],
  "rosarito": [32.36, -117.06],
  "ensenada": [31.87, -116.6],
  "mexicali": [32.62, -115.45],
  "los algodones": [32.7, -114.73],
  "algodones": [32.7, -114.73],
  "san luis rio colorado": [32.46, -114.77],
  "san felipe": [31.02, -114.84],
};
// "Lake Havasu" is the lake and the city on it.
BORDER["lake havasu"] = BORDER["lake havasu city"];

const key = (s) => keyOf(s).replace(/\bsaint\b/g, "st");

/** name key -> { name, region, kind } */
const TABLE = (() => {
  const t = new Map();
  const add = (name, region, kind, display = name) => {
    const k = key(name);
    if (k && !t.has(k)) t.set(k, { name: display, region, kind });
  };
  for (const [state, code, capital, cities] of STATES) {
    add(state, state, "state");
    if (!CODE_NEEDS_CITY.has(code)) add(code, state, "state", state);
    for (const c of [capital, ...cities.split(",")].map((x) => x.trim()).filter(Boolean)) {
      // "Portland Maine" is said as Portland, in Maine
      const bare = c.replace(new RegExp(`\\s+${state}$`, "i"), "").replace(/\s+(Mississippi|Nebraska|New Hampshire|New Jersey|New York|South Carolina|Virginia|West Virginia|Rhode Island|Washington|Puerto Rico|Maine)$/i, "");
      add(c, state, "city", bare);
    }
  }
  for (const [country, places] of Object.entries(COUNTRIES)) {
    add(country, country, "country");
    for (const c of places.split(",").map((x) => x.trim()).filter(Boolean)) {
      const bare = c.replace(new RegExp(`\\s+(${country}|England|Russia|Croatia|Italy|Spain|France|Ireland|Chile|Costa Rica|Canada)$`, "i"), "");
      add(c, country, /^(British Columbia|BC|Alberta|Saskatchewan|Manitoba|Ontario Canada|Quebec|New Brunswick|Nova Scotia|Prince Edward Island|Newfoundland|Yukon|Northwest Territories|Nunavut|Baja California|Baja|Baja California Sur|Sonora|England|Scotland|Wales|UK|Holland|Korea|UAE|Czechia|Turkiye|Algarve|Provence|Tuscany|Sicily|Hokkaido|Okinawa|Bali|Crete)$/i.test(c) ? "region" : "city", bare);
    }
  }
  add("United States", "United States", "country");
  add("Europe", "Europe", "region");
  add("Asia", "Asia", "region");
  add("Africa", "Africa", "region");
  add("South America", "South America", "region");
  add("Caribbean", "the Caribbean", "region");
  return t;
})();

const SUFFIXES = (() => {
  const s = new Map();
  for (const [state, code] of STATES) {
    s.set(key(state), state);
    s.set(key(code), state);
  }
  for (const c of Object.keys(COUNTRIES)) s.set(key(c), c);
  for (const [k, v] of [["usa", "the United States"], ["us", "the United States"], ["united states", "the United States"], ["uk", "United Kingdom"], ["bc", "Canada"], ["b c", "Canada"], ["ontario", "Canada"], ["quebec", "Canada"], ["alberta", "Canada"], ["british columbia", "Canada"], ["baja california", "Mexico"], ["baja", "Mexico"], ["bcn", "Mexico"], ["sonora", "Mexico"], ["mx", "Mexico"]])
    s.set(k, v);
  return s;
})();

/** Display text for a gazetteer hit: "Portland, Oregon", "Tokyo, Japan", "Oregon". */
const display = (hit) =>
  hit.kind === "city" || (hit.kind === "region" && hit.region !== hit.name && !/^the /.test(hit.region))
    ? `${hit.name}, ${hit.region}`
    : hit.name;

/** Whether the data or the list of real California and Nevada towns covers this name exactly. */
function covered(graph, k) {
  if (COVERED_HOMONYMS.has(k)) return true;
  if (resolveTown(graph, k, { exact: true })) return true;
  return graph.places.some((p) => key(p.name) === k);
}

/**
 * The place outside California and Nevada that `text` names, or null. Reads
 * "Portland, OR", "Phoenix", "Lisbon Portugal", "Hawaii", "Tokyo"; a covered
 * name ("Dublin", "Oregon House", "Reno, NV") is always null.
 * @returns {null | { asked: string, name: string, region: string, kind: string, display: string, point: {lat, lon} | null }}
 */
export function outsideCoverage(graph, text) {
  if (typeof text !== "string") return null;
  const k = key(text);
  if (!k || k.length < 2 || covered(graph, k)) return null;
  let hit = TABLE.get(k) ?? null;
  let region = hit?.region;
  if (!hit) {
    // "<place> <state or country>": Portland OR, Lisbon Portugal, Medford Oregon
    const words = k.split(" ");
    for (let n = Math.min(3, words.length - 1); n >= 1 && !hit; n--) {
      const suffix = words.slice(-n).join(" ");
      const where = SUFFIXES.get(suffix);
      if (!where || where === "California" || where === "Nevada") continue;
      // "Dublin Ireland" is Ireland's even though "Dublin" alone stays California's
      const head = words.slice(0, -n).join(" ");
      const known = TABLE.get(head);
      if (known && (known.region === where || where === "the United States")) hit = known;
      else hit = { name: titleCase(head), region: where, kind: "city" };
      region = hit.region;
    }
  }
  if (!hit) return null;
  const point = BORDER[k] ?? BORDER[key(hit.name)] ?? null;
  return {
    asked: text,
    name: hit.name,
    region,
    kind: hit.kind,
    display: display({ ...hit, region }),
    point: point ? { lat: point[0], lon: point[1] } : null,
  };
}

const titleCase = (s) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());

/** The covered towns within 100 miles of a point outside coverage, closest first (at most 3). */
export function closestCovered(graph, point) {
  if (!point) return [];
  return nearestTowns(graph, point, 3).filter((t) => t.distance_miles <= 100);
}

/** Whether a point lies outside California and Nevada's box (the schema's own bounds). */
export const outsideBox = (p) =>
  p && Number.isFinite(p.lat) && Number.isFinite(p.lon) &&
  (p.lat < 32 || p.lat > 42.1 || p.lon < -124.5 || p.lon > -114);

/** The answer fields for a place outside coverage: message, nearest towns, next steps. */
export function outsideFields(graph, outside) {
  const nearest = closestCovered(graph, outside.point);
  const where = outside.display;
  const message = `${where} is outside DogPolicies' coverage: the data covers dog rules in California and Nevada only.${
    nearest.length
      ? ` The closest covered town${nearest.length > 1 ? "s are" : " is"} ${nearest.map((t) => `${t.name}, ${t.state} (${t.distance_miles} mi)`).join(", ")}.`
      : ""
  }`;
  const next = [
    ...(nearest.length
      ? [`dogpolicies_near with place="${nearest[0].name}, ${nearest[0].state}" lists everything for dogs around the closest covered town`]
      : []),
    'Ask about a place in California or Nevada, e.g. place="Monterey", "Lake Tahoe" or "Las Vegas"',
  ];
  return { outcome: "no_match", code: "out_of_coverage", message, nearest, next, title: `${where} is outside California and Nevada` };
}

/** The same for a point given as near={lat, lon} outside California and Nevada. */
export function outsidePointFields(graph, point) {
  return outsideFields(graph, {
    display: `The point ${point.lat}, ${point.lon}`,
    point,
  });
}

// ---- Off topic: what DogPolicies is not for ----

const TOPICS = [
  ["flights", /\b(flights?|airfares?|airlines?|plane tickets?|boarding pass)\b/, "flights or airfares", 'Where are the pet relief areas at SFO? (dogpolicies_near with place="SFO")'],
  ["car rental", /\b(car rentals?|rental cars?|rent a car|car hire)\b/, "car rentals", 'Which hotels in Monterey take a 70 lb dog? (dogpolicies_find_hotels with county="Monterey", dog_weight_lb=70)'],
  ["weather", /\b(weather|forecasts?|temperatures?)\b/, "weather forecasts", "Are there chain controls on I-80 over Donner Pass? (dogpolicies_road_conditions with route=\"i-80\")"],
  ["prices", /^(cheap|cheapest|deals?|discounts?|coupons?|prices?|pricing|affordable|bargains?|room rates?)( (cheap|cheapest|deals?|discounts?|coupons?|prices?|pricing|affordable|bargains?|room rates?))*$/, "room rates or deals (it has pet fees)", 'Which Monterey hotels charge under $50 in pet fees for my dog? (dogpolicies_find_hotels with county="Monterey", max_total_fee=50)'],
];
const ALWAYS = 'Can I bring my dog to Carmel Beach? (dogpolicies_search_places with query="Carmel Beach")';

/** The off-topic subject `text` asks about ("cheap flights to tokyo" is flights), or null. */
export function offTopic(text) {
  if (typeof text !== "string") return null;
  const k = keyOf(text);
  for (const [topic, re, words, example] of TOPICS)
    if (re.test(k)) return { topic, words, example };
  return null;
}

/** The answer fields for an off-topic question, naming a place outside coverage when it names one. */
export function offTopicFields(graph, topic, outside, text = "") {
  // "cheap flights to tokyo": the place is at the end of the question
  if (!outside && text) {
    const words = keyOf(text).split(" ");
    for (let n = Math.min(3, words.length - 1); n >= 1 && !outside; n--)
      outside = outsideCoverage(graph, words.slice(-n).join(" "));
  }
  const message = `DogPolicies answers where dogs are allowed in California and Nevada: parks, beaches, trails, hotels, campgrounds, patios and rest areas, each rule with its official source. It has no ${topic.words}.${
    outside ? ` ${outside.display} is also outside its coverage.` : ""
  } Questions it answers: "${topic.example.replace(/ \(.*$/, "")}" and "${ALWAYS.replace(/ \(.*$/, "")}"`;
  return {
    outcome: "no_match",
    code: "off_topic",
    message,
    nearest: [],
    next: [topic.example, ALWAYS],
    title: "Not a question about dogs",
  };
}
