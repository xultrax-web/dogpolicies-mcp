// Change feeds (roadmap R-34): Atom 1.0 and JSON Feed 1.1 for one scope, a
// place, a town or area with a radius, or a highway's stops, computed on request
// from the answer dogpolicies_changes_near gives for it. The feed runs the same
// wrapped handler the MCP server and the HTTP operations run (rest.mjs), so a
// feed is a formatting of that answer, never a second copy of the logic:
//
//   /feeds/changes/place/<id>.atom|json
//   /feeds/changes/near/<town slug>.atom|json?radius=<miles>
//   /feeds/changes/route/<route id>.atom|json?from=<mile>&to=<mile>
//
// Nothing is stored per subscriber: the URL carries the scope. A correction
// ticket shows only its public fields (ticket, place, kind of fact, status,
// dates, reason category), whatever else its row holds. A scope that does not
// resolve is a valid feed with one entry saying so and what was meant.

import { createRestApi } from "./rest.mjs";
import { FEED_PREFIX, daysBefore, feedPath, feedUrls } from "./feed-urls.mjs";

export {
  DEFAULT_RADIUS,
  FEED_PREFIX,
  daysBefore,
  feedPath,
  feedSlug,
  feedUrls,
  townSlug,
} from "./feed-urls.mjs";

/** How far back a feed reaches; the newest MAX_ENTRIES entries in it are shown. */
export const FEED_WINDOW_DAYS = 365;
export const MAX_ENTRIES = 50;
/** Seconds a feed may be reused (Cache-Control). */
export const FEED_CACHE_SECONDS = 900;
const MAX_EVENT_PAGES = 40;
const TAG = "tag:dogpolicies.com,2026:";
export const FEED_TYPES = {
  atom: "application/atom+xml; charset=utf-8",
  json: "application/feed+json; charset=utf-8",
};

/**
 * Reads a feed path. Returns { kind, id, format, args } or null when the path
 * is not under /feeds/changes/. `kind` is null for a kind we do not serve.
 */
export function parseFeedPath(pathname, searchParams = new URLSearchParams()) {
  if (!pathname.startsWith(FEED_PREFIX)) return null;
  const rest = pathname.slice(FEED_PREFIX.length).replace(/\/+$/, "");
  const m = rest.match(/^([a-z]+)\/(.+?)(?:\.(atom|json|xml))?$/);
  if (!m) return { kind: null, id: rest, format: "atom", args: null };
  const [, kindRaw, idRaw, ext] = m;
  const format = ext === "json" ? "json" : "atom";
  let id;
  try {
    id = decodeURIComponent(idRaw);
  } catch {
    id = idRaw;
  }
  const kind = ["place", "near", "route"].includes(kindRaw) ? kindRaw : null;
  const num = (v) => (v == null || v === "" ? undefined : v);
  const args =
    kind === "place"
      ? { place_id: id }
      : kind === "near"
        ? {
            place: id.replace(/-/g, " "),
            ...(num(searchParams.get("radius")) != null
              ? { radius_miles: searchParams.get("radius") }
              : {}),
          }
        : kind === "route"
          ? {
              route: id,
              ...(num(searchParams.get("from")) != null
                ? { from_mile: searchParams.get("from") }
                : {}),
              ...(num(searchParams.get("to")) != null
                ? { to_mile: searchParams.get("to") }
                : {}),
            }
          : null;
  return { kind, id, format, args };
}

// ---- Entries ----

/** FNV-1a, 32 bits, as 8 hex digits: a short stable fingerprint for an id. */
export function fingerprint(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

const WORDS = {
  changed: "rule changed",
  source_gone: "official source page gone",
  blocked: "official source could not be read",
  disputed: "rule disputed",
  confirmed: "verified",
};
const BY = {
  business: "confirmed by the business",
  agency: "confirmed by the agency",
};
const FACT = (f) =>
  String(f)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .toLowerCase();
const REASON = {
  not_supported_by_source: "the official source does not support it",
  duplicate: "already reported",
  out_of_scope: "not a dog rule we record",
  could_not_verify: "could not be verified",
  spam: "not a real report",
};

const routine = (e) =>
  e.outcome === "confirmed" && (e.by === "editor" || e.by === "recheck-script");

function eventEntry(e) {
  const what =
    e.outcome === "confirmed" && BY[e.by]
      ? BY[e.by]
      : (WORDS[e.outcome] ?? e.outcome.replaceAll("_", " "));
  const summary = [
    e.facts?.length ? `Facts: ${e.facts.map(FACT).join(", ")}.` : null,
    e.note ?? null,
    e.from != null ? `From: ${e.from}` : null,
    e.to != null ? `To: ${e.to}` : null,
  ]
    .filter(Boolean)
    .join(" ");
  const key = [e.facts?.join(","), e.note, e.from, e.to].join("|");
  return {
    id: `${TAG}event/${e.placeUid ?? e.placeId}/${e.at}/${e.outcome}/${e.by}/${fingerprint(key)}`,
    date: e.at,
    title: `${e.name}: ${what}`,
    url: e.url,
    summary: summary || `${e.name}: ${what} on ${e.at}.`,
    tags: ["verification", e.outcome],
  };
}

function dayEntry(date, events, scopeKey, fallbackUrl) {
  const names = [...new Set(events.map((e) => e.name))];
  if (names.length === 1) {
    const e = events[0];
    const facts = [...new Set(events.flatMap((x) => x.facts ?? []))];
    return {
      id: `${TAG}verified/${date}/${e.placeUid ?? e.placeId}`,
      date,
      title: `${e.name}: verified against its official source`,
      url: e.url,
      summary:
        [
          facts.length ? `Facts: ${facts.map(FACT).join(", ")}.` : null,
          events.length === 1 ? (e.note ?? null) : null,
        ]
          .filter(Boolean)
          .join(" ") ||
        `${e.name} was verified against its official source on ${date}.`,
      tags: ["verification", "confirmed"],
    };
  }
  const shown = names.slice(0, 12);
  return {
    id: `${TAG}verified/${date}/${fingerprint(scopeKey)}`,
    date,
    title: `${names.length} records verified on ${date}`,
    url: fallbackUrl,
    summary: `${names.length} records had their official sources read and their rules confirmed on ${date}: ${shown.join(", ")}${names.length > shown.length ? `, and ${names.length - shown.length} more` : ""}.`,
    tags: ["verification", "confirmed"],
  };
}

function ruleChangeEntry(c, g, site) {
  const p = c.placeId ? g.placeById.get(c.placeId) : null;
  const subject = p?.uid ?? (c.brandId ? `brand-${c.brandId}` : c.placeId);
  const url = p
    ? p.url
    : c.brandId
      ? `${site}/brands/${c.brandId}/`
      : `${site}/changes/`;
  return {
    id: `${TAG}change/${c.date}/${subject}/${c.field ?? c.kind}`,
    date: c.date,
    title:
      c.kind === "changed"
        ? `${c.name}: ${FACT(c.field ?? "rule")} changed`
        : c.kind === "added"
          ? `${c.name}: added to the official list`
          : c.kind === "removed"
            ? `${c.name}: removed from the official list`
            : `${c.name}: ${c.kind}`,
    url,
    summary:
      c.kind === "changed"
        ? `${FACT(c.field ?? "rule")}: "${c.from ?? ""}" became "${c.to ?? ""}".`
        : `${c.name} was ${c.kind} on ${c.date}.`,
    tags: ["rule-change", c.kind],
  };
}

/** Only the public fields of a ticket ever reach a feed. */
function correctionEntry(t) {
  const ticket = String(t.ticket);
  const status = String(t.status);
  const fact =
    t.fact && t.fact !== "unspecified" ? `the ${FACT(t.fact)}` : "a fact";
  const filed = t.filed_at ? ` on ${t.filed_at}` : "";
  const decided =
    status === "verified"
      ? ` Verified${t.decided_at ? ` on ${t.decided_at}` : ""}: the record was updated.`
      : status === "rejected"
        ? ` Rejected${t.decided_at ? ` on ${t.decided_at}` : ""}${t.reason ? `: ${REASON[t.reason] ?? String(t.reason).replaceAll("_", " ")}` : ""}.`
        : " Waiting for a person to check the official source.";
  return {
    id: `${TAG}correction/${ticket}/${status}`,
    date: String(t.decided_at ?? t.filed_at ?? t.changed_at ?? ""),
    title: `${t.place_name}: correction ${ticket} ${status}`,
    url: String(t.status_url),
    summary: `A correction to ${fact} was filed${filed}.${decided}`,
    tags: ["correction", status],
  };
}

/** Feed entries from a changes_near answer, newest first, at most `max`. */
export function feedEntries(
  answer,
  { graph, site, scopeKey, max = MAX_ENTRIES },
) {
  const entries = [];
  const byDay = new Map();
  for (const e of answer.events ?? []) {
    if (routine(e)) {
      if (!byDay.has(e.at)) byDay.set(e.at, []);
      byDay.get(e.at).push(e);
    } else entries.push(eventEntry(e));
  }
  const fallback = answer.page_url ?? `${site}/changes/`;
  for (const [date, events] of byDay)
    entries.push(dayEntry(date, events, `${scopeKey}|${date}`, fallback));
  for (const c of answer.rule_changes ?? [])
    entries.push(ruleChangeEntry(c, graph, site));
  for (const t of answer.corrections ?? []) entries.push(correctionEntry(t));
  return entries
    .filter((e) => /^\d{4}-\d{2}-\d{2}/.test(e.date))
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id))
    .slice(0, max);
}

// ---- Rendering ----

const xml = (s) =>
  String(s)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const stamp = (date) => `${String(date).slice(0, 10)}T00:00:00Z`;

/** Atom 1.0 (RFC 4287). */
export function renderAtom(feed) {
  const updated = stamp(feed.entries[0]?.date ?? feed.as_of);
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en-US">
  <title>${xml(feed.title)}</title>
  <subtitle>${xml(feed.description)}</subtitle>
  <link rel="self" type="application/atom+xml" href="${xml(feed.atom_url)}"/>
  <link rel="alternate" type="application/feed+json" href="${xml(feed.json_url)}"/>
  <link rel="alternate" type="text/html" href="${xml(feed.home_page_url)}"/>
  <id>${xml(feed.atom_url)}</id>
  <updated>${updated}</updated>
  <author><name>${xml(feed.author.name)}</name><uri>${xml(feed.author.url)}</uri></author>
  <rights>${xml(feed.rights)}</rights>
  <generator uri="${xml(feed.author.url)}">${xml(feed.author.name)}</generator>
${feed.entries
  .map(
    (e) => `  <entry>
    <title>${xml(e.title)}</title>
    <link rel="alternate" type="text/html" href="${xml(e.url)}"/>
    <id>${xml(e.id)}</id>
    <published>${stamp(e.date)}</published>
    <updated>${stamp(e.date)}</updated>
${e.tags.map((t) => `    <category term="${xml(t)}"/>`).join("\n")}
    <summary type="text">${xml(e.summary)}</summary>
  </entry>`,
  )
  .join("\n")}
</feed>
`;
}

/** JSON Feed 1.1 (https://jsonfeed.org/version/1.1). */
export function renderJsonFeed(feed) {
  return JSON.stringify(
    {
      version: "https://jsonfeed.org/version/1.1",
      title: feed.title,
      home_page_url: feed.home_page_url,
      feed_url: feed.json_url,
      description: feed.description,
      authors: [{ name: feed.author.name, url: feed.author.url }],
      language: "en-US",
      items: feed.entries.map((e) => ({
        id: e.id,
        url: e.url,
        title: e.title,
        content_text: e.summary,
        date_published: stamp(e.date),
        tags: e.tags,
      })),
      _dogpolicies: {
        about:
          "Verification events, rule changes and public correction tickets for one scope, newest first, computed when this feed is read.",
        scope: feed.scope,
        as_of: feed.as_of,
        license: feed.license,
        atom_url: feed.atom_url,
        ...(feed.outcome ? { outcome: feed.outcome } : {}),
        ...(feed.did_you_mean ? { did_you_mean: feed.did_you_mean } : {}),
      },
    },
    null,
    2,
  );
}

// ---- The feed service ----

/** One read of the corrections per feed request, however many pages it reads. */
function onceShortly(load, ms = 5000) {
  let last = null;
  return (q) => {
    const key = `${q.since}|${q.limit}`;
    const now = Date.now();
    if (last && last.key === key && now - last.at < ms) return last.promise;
    const promise = Promise.resolve().then(() => load(q));
    last = { key, at: now, promise };
    promise.catch(() => {
      if (last?.promise === promise) last = null;
    });
    return promise;
  };
}

const scopeTitle = (answer, kind) =>
  kind === "place"
    ? `Dog rule changes at ${answer.label}`
    : kind === "route"
      ? `Dog rule changes at the stops on ${answer.label}`
      : answer.scope_kind === "area"
        ? `Dog rule changes in ${answer.label}`
        : `Dog rule changes within ${answer.radius_miles} miles of ${answer.label}`;

/**
 * The feeds over a runtime.
 * @param {object} ctx the runtime (createRuntime)
 */
export function createFeeds(ctx) {
  // The runtime as the feeds see it: the same graph and tools, with the
  // correction list read once for all the pages of one feed.
  const feedCtx = Object.create(ctx, {
    corrections: {
      value: ctx.corrections ? onceShortly(ctx.corrections) : null,
    },
  });
  const rest = createRestApi(feedCtx, { cacheSize: 20 });
  const graph = () => ctx.graph;
  const siteRoot = () => ctx.graph.site.url.replace(/\/+$/, "");

  /** Every event page of the changes_near answer for a scope; the first call carries the counting hooks. */
  async function answerFor(args, since, hooks) {
    let page = null;
    const events = [];
    let offset = 0;
    for (let i = 0; i < MAX_EVENT_PAGES; i++) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(args)) params.set(k, String(v));
      params.set("since", since);
      params.set("limit", "50");
      params.set("offset", String(offset));
      params.set("response_format", "json");
      const out = await rest.run("changes-near", params, i === 0 ? hooks : {});
      if (out.status !== 200) return { status: out.status, body: out.body };
      page = out.body;
      events.push(...(page.events ?? []));
      if (!page.has_more || !page.count || page.outcome) break;
      offset = page.next_offset ?? offset + page.count;
    }
    return { status: 200, body: { ...page, events } };
  }

  function explain({
    parsed,
    title,
    message,
    did_you_mean = [],
    next = [],
    outcome,
    url,
  }) {
    const site = siteRoot();
    const g = graph();
    const scope =
      parsed.kind && parsed.id ? { kind: parsed.kind, id: parsed.id } : null;
    const urls = scope
      ? feedUrls(site, scope)
      : { atom: `${site}${FEED_PREFIX}`, json: `${site}${FEED_PREFIX}` };
    const meant = did_you_mean
      .slice(0, 5)
      .map((d) => d.name ?? d.id)
      .filter(Boolean);
    return {
      title: `Dog rule changes: ${title}`,
      description: message,
      atom_url: urls.atom,
      json_url: urls.json,
      home_page_url: `${site}/changes/`,
      as_of: g.as_of,
      outcome,
      did_you_mean,
      scope: { kind: parsed.kind, asked: parsed.id },
      entries: [
        {
          id: `${TAG}scope-not-found/${fingerprint(`${parsed.kind}|${parsed.id}`)}`,
          date: g.as_of,
          title,
          url: url ?? `${site}/changes/`,
          summary: [
            message,
            meant.length ? `Did you mean: ${meant.join(", ")}?` : null,
            ...next,
          ]
            .filter(Boolean)
            .join(" "),
          tags: ["scope-not-found"],
        },
      ],
    };
  }

  /**
   * Answers one feed request.
   * @param {string} pathname
   * @param {URLSearchParams} searchParams
   * @param {{ onToolCall?: Function, onToolResult?: Function }} [hooks] counting
   * @returns {Promise<{ status: number, contentType: string, body: string, cache: number, format: string }>}
   */
  async function run(pathname, searchParams, hooks = {}) {
    const parsed = parseFeedPath(pathname, searchParams);
    if (!parsed) return null;
    const g = graph();
    const site = siteRoot();
    const finish = (feed) => ({
      status: 200,
      format: parsed.format,
      contentType: FEED_TYPES[parsed.format],
      body: parsed.format === "json" ? renderJsonFeed(feed) : renderAtom(feed),
      cache: FEED_CACHE_SECONDS,
    });
    const base = {
      author: { name: g.site.name, url: `${site}/` },
      rights: `${g.site.license.name} ${g.site.license.url}`,
      license: g.site.license,
    };
    if (!parsed.kind)
      return finish({
        ...base,
        ...explain({
          parsed,
          title: "Not a feed address",
          message: `"${pathname}" is not one of the change feeds. A feed follows one place, a town or area, or a highway.`,
          outcome: "bad_input",
          next: [
            `${site}${FEED_PREFIX}place/carmel-beach.atom`,
            `${site}${FEED_PREFIX}near/lake-tahoe.atom?radius=25`,
            `${site}${FEED_PREFIX}route/i-5.atom?from=170&to=222`,
          ],
        }),
      });
    const since = daysBefore(ctx.today(), FEED_WINDOW_DAYS);
    const { status, body } = await answerFor(parsed.args, since, hooks);
    if (status !== 200 || body.outcome) {
      const bad = status !== 200;
      const did_you_mean = bad ? [] : (body.did_you_mean ?? []);
      return finish({
        ...base,
        ...explain({
          parsed,
          title: bad
            ? `The feed address could not be read`
            : `No ${parsed.kind === "route" ? "route" : "place"} "${parsed.id}" in the data`,
          message: bad
            ? `This feed's options did not match what the feed takes (radius is 1 to 100 miles; from and to are route miles).`
            : (body.message ?? `"${parsed.id}" was not found.`),
          outcome: bad ? "bad_input" : body.outcome,
          did_you_mean,
          next: bad ? [] : (body.next ?? []),
        }),
      });
    }
    // The feed's own address, from the scope the answer resolved to.
    const scope =
      parsed.kind === "place"
        ? { kind: "place", id: body.place_id }
        : parsed.kind === "route"
          ? {
              kind: "route",
              id: body.route,
              from: body.from_mile ?? null,
              to: body.to_mile ?? null,
            }
          : {
              kind: "near",
              id: parsed.id,
              radius: body.scope_kind === "area" ? null : body.radius_miles,
            };
    const urls = feedUrls(site, scope);
    const scopeKey = feedPath(scope);
    const entries = feedEntries(body, { graph: g, site, scopeKey });
    return finish({
      ...base,
      title: `${scopeTitle(body, parsed.kind)} | ${g.site.name}`,
      description: `Verification events, rule changes and public correction tickets for ${body.label}, newest first, each from the record's official source. Computed when read; nothing about the reader is stored.`,
      atom_url: urls.atom,
      json_url: urls.json,
      home_page_url: body.page_url ?? `${site}/changes/`,
      as_of: g.as_of,
      scope: {
        kind: parsed.kind,
        id: scope.id,
        label: body.label,
        ...(scope.radius != null ? { radius_miles: scope.radius } : {}),
        ...(parsed.kind === "route"
          ? { from_mile: scope.from, to_mile: scope.to }
          : {}),
        since,
        verification_events: body.total ?? 0,
        rule_changes: (body.rule_changes ?? []).length,
        corrections: body.corrections_total ?? 0,
      },
      entries,
    });
  }

  return { run };
}
