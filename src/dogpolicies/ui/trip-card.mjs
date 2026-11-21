// The trip card (roadmap R-27, release 0.6.0): an MCP Apps view (io.modelcontextprotocol/ui, the
// ext-apps specification) that Claude and ChatGPT draw beside the answers of the tools that declare it
// (plan_trip, near, route_stops, emergency_vet). One self-contained HTML document: no framework, no
// request leaves the frame (the default CSP stands), every value from the tool result is set as text,
// never as markup. Links open through the host (ui/open-link). Clients without MCP Apps never see it;
// the tool's text answer is unchanged.
//
// The script inside is plain ES5-style JavaScript in a String.raw template, so it must contain no
// backticks and no dollar-brace sequences.

export const CARD_URI = "ui://dogpolicies/trip-card";
export const CARD_MIME = "text/html;profile=mcp-app";

const html = (version) => String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DogPolicies</title>
<style>
:root {
  color-scheme: light dark;
  --dp-accent: light-dark(#1f5c45, #3fe0a0);
  --dp-yes-bg: light-dark(#ddf3e8, #12382c); --dp-yes-fg: light-dark(#0f6b47, #4fd6a0);
  --dp-res-bg: light-dark(#fbefd9, #2e2412); --dp-res-fg: light-dark(#8a5a00, #e8a94a);
  --dp-no-bg: light-dark(#fbe5e3, #3a1d17); --dp-no-fg: light-dark(#b3261e, #f08a80);
  --dp-var-bg: light-dark(#e6edf3, #1c2733); --dp-var-fg: light-dark(#2f4258, #a9bfd6);
  --dp-vet-bg: light-dark(#e9e4f7, #241d3a); --dp-vet-fg: light-dark(#4e3a86, #c3b3f2);
}
:root[data-theme="light"] { color-scheme: light; }
:root[data-theme="dark"] { color-scheme: dark; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: transparent; }
body {
  font-family: var(--font-sans, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif);
  font-size: var(--font-text-sm-size, 14px);
  line-height: var(--font-text-sm-line-height, 1.45);
  color: var(--color-text-primary, light-dark(#0a1f17, #dde7e1));
}
.card { padding: 14px 16px 12px; }
.top { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
h1 { font-size: var(--font-heading-sm-size, 16px); line-height: 1.3; margin: 0; font-weight: var(--font-weight-semibold, 600); }
.brand { font-size: 12px; color: var(--color-text-secondary, light-dark(#3f5a4d, #9baea4)); white-space: nowrap; }
.brand b { color: var(--dp-accent); font-weight: 600; }
.sub { color: var(--color-text-secondary, light-dark(#3f5a4d, #9baea4)); margin: -4px 0 10px; font-size: 13px; }
h2 { font-size: 12px; letter-spacing: .04em; text-transform: uppercase; margin: 14px 0 6px; color: var(--color-text-secondary, light-dark(#3f5a4d, #9baea4)); font-weight: 600; }
ul { list-style: none; margin: 0; padding: 0; }
li.item { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; padding: 8px 0; border-top: 1px solid var(--color-border-tertiary, light-dark(#dde7e1, #26352d)); }
li.item:first-child { border-top: 0; }
.mark { grid-row: 1 / span 4; width: 58px; text-align: right; font-variant-numeric: tabular-nums; color: var(--color-text-secondary, light-dark(#3f5a4d, #9baea4)); font-size: 12px; padding-top: 2px; }
li.item > :not(.mark) { grid-column: 2; min-width: 0; }
.legend { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 11px; color: var(--color-text-secondary, light-dark(#3f5a4d, #9baea4)); margin: 0 0 4px; }
.legend i { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 5px; vertical-align: -1px; }
.line { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; }
a.name { color: var(--dp-accent); font-weight: 600; text-decoration: none; cursor: pointer; }
a.name:hover { text-decoration: underline; }
.where { color: var(--color-text-secondary, light-dark(#3f5a4d, #9baea4)); font-size: 12px; }
.rule { color: var(--color-text-primary, inherit); font-size: 13px; }
.chip { display: inline-block; font-size: 11px; font-weight: 600; border-radius: 999px; padding: 1px 8px; white-space: nowrap; }
.chip.yes { background: var(--dp-yes-bg); color: var(--dp-yes-fg); }
.chip.yes_restricted { background: var(--dp-res-bg); color: var(--dp-res-fg); }
.chip.no { background: var(--dp-no-bg); color: var(--dp-no-fg); }
.chip.varies, .chip.unknown { background: var(--dp-var-bg); color: var(--dp-var-fg); }
.chip.vet { background: var(--dp-vet-bg); color: var(--dp-vet-fg); }
.road { position: relative; padding-left: 4px; }
.road li.item .mark { position: relative; }
.map { display: block; width: 100%; height: auto; margin: 4px 0 6px; border-radius: var(--border-radius-md, 8px); background: var(--color-background-secondary, light-dark(#f6faf7, #16221d)); }
.actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
button.act { font: inherit; font-size: 13px; font-weight: 600; border-radius: var(--border-radius-md, 8px); padding: 7px 12px; cursor: pointer; border: 1px solid var(--dp-accent); background: var(--dp-accent); color: light-dark(#ffffff, #0a1f17); }
button.act.ghost { background: transparent; color: var(--dp-accent); }
.foot { margin-top: 12px; font-size: 11px; color: var(--color-text-tertiary, light-dark(#6a8577, #7f938a)); }
.empty { color: var(--color-text-secondary, light-dark(#3f5a4d, #9baea4)); padding: 6px 0; }
.more { font-size: 12px; color: var(--color-text-secondary, light-dark(#3f5a4d, #9baea4)); padding-top: 4px; }
</style>
</head>
<body>
<div class="card" id="card"><p class="empty">Loading the plan...</p></div>
<script>
(function () {
  var VERSION = "${version}";
  var SITE = "https://dogpolicies.com/";
  var inHost = window.parent && window.parent !== window;
  var nextId = 0;
  var pending = {};
  var card = document.getElementById("card");

  function post(msg) { if (inHost) window.parent.postMessage(msg, "*"); }
  function request(method, params) {
    var id = ++nextId;
    post({ jsonrpc: "2.0", id: id, method: method, params: params || {} });
    return new Promise(function (resolve, reject) {
      pending[id] = { resolve: resolve, reject: reject };
      setTimeout(function () { if (pending[id]) { delete pending[id]; reject(new Error("timeout")); } }, 10000);
    });
  }
  function notify(method, params) { post({ jsonrpc: "2.0", method: method, params: params || {} }); }

  function applyContext(ctx) {
    if (!ctx) return;
    if (ctx.theme === "light" || ctx.theme === "dark") document.documentElement.setAttribute("data-theme", ctx.theme);
    var vars = ctx.styles && ctx.styles.variables;
    if (vars) for (var k in vars) if (Object.prototype.hasOwnProperty.call(vars, k) && vars[k] && k.indexOf("--") === 0) document.documentElement.style.setProperty(k, String(vars[k]));
  }

  function open(url) {
    if (!url || !/^https:\/\/|^tel:/.test(url)) return;
    if (!inHost) { window.open(url, "_blank", "noopener"); return; }
    request("ui/open-link", { url: url }).catch(function () {});
  }

  function sizeChanged() {
    var h = Math.ceil(document.documentElement.getBoundingClientRect().height);
    notify("ui/notifications/size-changed", { height: h });
  }

  // ---- building blocks, all text ----
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = String(text);
    return e;
  }
  var CHIP = { yes: "Dogs welcome", yes_restricted: "With limits", no: "No dogs", varies: "Varies", unknown: "Not stated" };
  function chip(status) { return el("span", "chip " + (CHIP[status] ? status : "unknown"), CHIP[status] || "Not stated"); }
  function short(s, n) { s = String(s || ""); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, "") + "..." : s; }
  function link(name, url) {
    var a = el("a", "name", name);
    a.href = url || SITE;
    a.addEventListener("click", function (ev) { ev.preventDefault(); open(url); });
    return a;
  }
  function item(markText, p, extra) {
    var li = el("li", "item");
    li.appendChild(el("div", "mark", markText || ""));
    var line = el("div", "line");
    line.appendChild(link(p.name, p.url));
    if (p.status) line.appendChild(chip(p.status));
    if (extra && extra.chip) line.appendChild(extra.chip);
    var where = [p.city, p.state].filter(Boolean).join(", ");
    if (where) line.appendChild(el("span", "where", where));
    li.appendChild(line);
    var rule = p.rule || p.answer;
    if (rule) li.appendChild(el("div", "rule", short(rule, 170)));
    if (extra && extra.note) li.appendChild(el("div", "where", extra.note));
    return li;
  }
  function miles(d) { return d == null ? "" : (Math.round(d * 10) / 10) + " mi"; }

  // A dot map from the records' own coordinates: no tiles, no outside requests.
  function dotMap(points, center) {
    var pts = points.filter(function (p) { return p && p.geo && typeof p.geo.lat === "number"; });
    if (pts.length < 2) return null;
    var lats = pts.map(function (p) { return p.geo.lat; }), lons = pts.map(function (p) { return p.geo.lon; });
    if (center) { lats.push(center.lat); lons.push(center.lon); }
    var minLat = Math.min.apply(null, lats), maxLat = Math.max.apply(null, lats);
    var minLon = Math.min.apply(null, lons), maxLon = Math.max.apply(null, lons);
    var k = Math.cos((minLat + maxLat) / 2 * Math.PI / 180);
    var w = 600, h = 220, pad = 18;
    var spanX = Math.max((maxLon - minLon) * k, 0.01), spanY = Math.max(maxLat - minLat, 0.01);
    var s = Math.min((w - 2 * pad) / spanX, (h - 2 * pad) / spanY);
    var ox = (w - spanX * s) / 2, oy = (h - spanY * s) / 2;
    function xy(lat, lon) { return [ox + (lon - minLon) * k * s, h - (oy + (lat - minLat) * s)]; }
    var NS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 " + w + " " + h);
    svg.setAttribute("class", "map");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Map of the places listed below");
    var COLOR = { yes: "#0f6b47", yes_restricted: "#c98a12", no: "#b3261e", vet: "#6a4fc0" };
    if (center) svg.setAttribute("data-center", "1");
    if (center) {
      var c = xy(center.lat, center.lon);
      var ring = document.createElementNS(NS, "circle");
      ring.setAttribute("cx", c[0]); ring.setAttribute("cy", c[1]); ring.setAttribute("r", 7);
      ring.setAttribute("fill", "none"); ring.setAttribute("stroke", "currentColor"); ring.setAttribute("stroke-width", 2);
      svg.appendChild(ring);
    }
    pts.forEach(function (p, i) {
      var q = xy(p.geo.lat, p.geo.lon);
      var dot = document.createElementNS(NS, "circle");
      dot.setAttribute("cx", q[0]); dot.setAttribute("cy", q[1]); dot.setAttribute("r", 5);
      dot.setAttribute("fill", COLOR[p._kind === "vet" ? "vet" : p.status] || "#2f4258");
      dot.setAttribute("stroke", "white"); dot.setAttribute("stroke-width", 1.5);
      var t = document.createElementNS(NS, "title"); t.textContent = (i + 1) + ". " + p.name; dot.appendChild(t);
      svg.appendChild(dot);
    });
    return svg;
  }

  function placeMap(m, kinds) {
    if (!m) return;
    var first = card.querySelector("h2, ul, p.empty");
    var key = el("div", "legend");
    [["#0f6b47", "dogs welcome", "yes"], ["#c98a12", "with limits", "yes_restricted"], ["#b3261e", "no dogs", "no"], ["#6a4fc0", "emergency vet", "vet"]].forEach(function (k) {
      if (kinds && kinds.indexOf(k[2]) < 0) return;
      var span = el("span"); var dot = el("i"); dot.style.background = k[0]; span.appendChild(dot); span.appendChild(document.createTextNode(k[1])); key.appendChild(span);
    });
    if (m.getAttribute("data-center") === "1") { var c = el("span"); var ring = el("i"); ring.style.border = "2px solid currentColor"; ring.style.width = "8px"; ring.style.height = "8px"; c.appendChild(ring); c.appendChild(document.createTextNode("the town asked about")); key.appendChild(c); }
    card.insertBefore(m, first);
    card.insertBefore(key, first);
  }
  function kindsOf(pts) { var k = []; pts.forEach(function (p) { var x = p._kind === "vet" ? "vet" : p.status; if (k.indexOf(x) < 0) k.push(x); }); return k; }
  function header(title, sub) {
    var top = el("div", "top");
    top.appendChild(el("h1", null, title));
    var b = el("span", "brand"); b.appendChild(el("b", null, "DogPolicies")); b.appendChild(document.createTextNode(" verified rules"));
    top.appendChild(b);
    card.appendChild(top);
    if (sub) card.appendChild(el("p", "sub", sub));
  }
  function footer(sc) {
    var f = el("div", "foot", "Every rule from the place's own source, with the date it was checked. " + (sc.attribution_text || "DogPolicies, dogpolicies.com, CC BY 4.0") + ".");
    card.appendChild(f);
  }
  function actions(list) {
    var box = el("div", "actions");
    list.forEach(function (a, i) {
      var b = el("button", "act" + (i ? " ghost" : ""), a.label);
      b.type = "button";
      b.addEventListener("click", function () { open(a.url); });
      box.appendChild(b);
    });
    card.appendChild(box);
  }

  // ---- the shapes ----
  function renderTrip(sc) {
    header(sc.label ? "Dog-friendly trip: " + sc.label : "Dog-friendly trip", sc.days && sc.days.length ? sc.days.length + (sc.days.length === 1 ? " day" : " days") + " planned" : null);
    var mapPts = [];
    if (sc.days && sc.days.length) {
      sc.days.forEach(function (d) {
        card.appendChild(el("h2", null, "Day " + d.day + (d.date ? ", " + d.date : "")));
        var ul = el("ul");
        [["Stay", d.stay], ["Morning", d.morning], ["Afternoon", d.afternoon], ["Evening", d.evening]].forEach(function (slot) {
          if (slot[1]) { ul.appendChild(item(slot[0], slot[1])); }
        });
        card.appendChild(ul);
      });
    }
    var stays = sc.stays || [];
    if (stays.length) {
      card.appendChild(el("h2", null, "Places to stay"));
      var ul2 = el("ul");
      stays.slice(0, 5).forEach(function (p, i) { mapPts.push(p); ul2.appendChild(item(String(i + 1), p)); });
      card.appendChild(ul2);
    }
    (sc.outings || []).forEach(function (o) {
      if (!o.places || !o.places.length) return;
      card.appendChild(el("h2", null, o.label));
      var ul3 = el("ul");
      o.places.slice(0, 3).forEach(function (p) { mapPts.push(p); ul3.appendChild(item(miles(p.distance_miles), p)); });
      card.appendChild(ul3);
    });
    if (sc.vet) vetBlock([sc.vet], "Nearest 24-hour emergency vet");
    placeMap(dotMap(mapPts, sc.center), kindsOf(mapPts));
    var acts = [];
    if (sc.trip_url) acts.push({ label: "Open the live trip", url: sc.trip_url });
    acts.push({ label: "More on dogpolicies.com", url: SITE });
    actions(acts);
  }

  function renderNear(sc) {
    header("Dog-friendly near " + (sc.label || "here"), sc.radius_miles ? "Within " + sc.radius_miles + " miles" : null);
    var pts = [];
    (sc.groups || []).forEach(function (g) {
      var places = g.places || g.items || [];
      if (!places.length) return;
      card.appendChild(el("h2", null, g.label + (g.total > places.length ? " (" + g.total + ")" : "")));
      var ul = el("ul");
      places.slice(0, 4).forEach(function (p) { pts.push(p); ul.appendChild(item(miles(p.distance_miles), p)); });
      card.appendChild(ul);
      if (places.length > 4) card.appendChild(el("div", "more", (places.length - 4) + " more in the answer"));
    });
    if (sc.vet) vetBlock([sc.vet], "Nearest 24-hour emergency vet");
    if (!pts.length) card.appendChild(el("p", "empty", "Nothing listed within reach; the answer says what was tried."));
    placeMap(dotMap(pts, sc.center), kindsOf(pts));
    actions([{ label: "Open on dogpolicies.com", url: SITE + "near/" }]);
  }

  function renderRoute(sc) {
    var r = sc.route;
    var name = typeof r === "string" ? r : (r && (r.name || r.label || r.id)) || "the road";
    var dir = sc.direction ? sc.direction.charAt(0).toUpperCase() + sc.direction.slice(1) + "bound" : null;
    header("Dog stops on " + name, [dir, sc.from_mile != null ? "from mile " + sc.from_mile : null].filter(Boolean).join(", "));
    var ul = el("ul", "road");
    var stops = sc.stops || [];
    stops.slice(0, 12).forEach(function (s) {
      var p = s.place || s;
      var mark = s.mile != null ? "mi " + s.mile : (s.mileLabel || "");
      var off = s.off_route_miles != null && s.off_route_miles > 0.2 ? miles(s.off_route_miles) + " off the road" : null;
      ul.appendChild(item(mark, p, { note: [s.exit ? "Exit " + String(s.exit).replace(/^exit\s*/i, "") : null, off].filter(Boolean).join(" · ") || null }));
    });
    card.appendChild(ul);
    if (!stops.length) card.appendChild(el("p", "empty", "No stops in this stretch."));
    if (stops.length > 12) card.appendChild(el("div", "more", (stops.length - 12) + " more stops in the answer"));
    if (sc.vets && sc.vets.length) vetBlock(sc.vets, sc.vets.length > 1 ? "Nearest 24-hour emergency vets to this stretch" : "Nearest 24-hour emergency vet");
    actions([{ label: typeof sc.guide === "string" ? "The " + name + " road-trip guide" : "Road-trip guides", url: typeof sc.guide === "string" ? sc.guide : SITE + "road-trips/" }]);
  }

  function vetBlock(vets, title) {
    card.appendChild(el("h2", null, title));
    var ul = el("ul");
    vets.forEach(function (v) {
      var p = { name: v.name, url: v.url, city: v.city, state: v.state, rule: v.hours || (v.emergency === "24_7" ? "Open 24 hours, every day" : null), geo: v.geo, _kind: "vet" };
      var li = item(miles(v.distance_miles), p, { chip: el("span", "chip vet", v.emergency === "24_7" ? "24 hours" : "Emergency hours") });
      if (v.phone) {
        var tel = el("a", "name", v.phone);
        var digits = String(v.phone).replace(/[^0-9+]/g, "");
        tel.href = "tel:" + digits;
        tel.addEventListener("click", function (ev) { ev.preventDefault(); open("tel:" + digits); });
        var line = el("div", "where"); line.appendChild(document.createTextNode("Call ahead: ")); line.appendChild(tel);
        li.appendChild(line);
      }
      ul.appendChild(li);
    });
    card.appendChild(ul);
  }

  function renderVets(sc) {
    header("Emergency vets near " + (sc.label || "here"), "Call ahead: hours and services change. Not medical advice.");
    var vets = sc.vets || [];
    if (vets.length) vetBlock(vets, vets.length + " open or 24-hour hospitals");
    else card.appendChild(el("p", "empty", "No emergency hospital within reach; the answer names the nearest."));
    placeMap(dotMap(vets.map(function (v) { return { name: v.name, geo: v.geo, _kind: "vet" }; }), sc.center), ["vet"]);
  }

  function render(result) {
    var sc = (result && result.structuredContent) || {};
    card.textContent = "";
    try {
      if (sc.vets) renderVets(sc);
      else if (sc.days || sc.stays) renderTrip(sc);
      else if (sc.groups) renderNear(sc);
      else if (sc.stops) renderRoute(sc);
      else card.appendChild(el("p", "empty", "The answer is in the reply."));
      footer(sc);
    } catch (e) {
      card.textContent = "";
      card.appendChild(el("p", "empty", "The answer is in the reply."));
    }
    sizeChanged();
  }

  window.addEventListener("message", function (ev) {
    var m = ev.data;
    if (!m || m.jsonrpc !== "2.0") return;
    if (m.id != null && pending[m.id] && (m.result !== undefined || m.error)) {
      var p = pending[m.id]; delete pending[m.id];
      if (m.error) p.reject(m.error); else p.resolve(m.result);
      return;
    }
    if (m.method === "ui/notifications/tool-result") render(m.params);
    else if (m.method === "ui/notifications/host-context-changed") applyContext(m.params);
    else if (m.method === "ping" && m.id != null) post({ jsonrpc: "2.0", id: m.id, result: {} });
  });
  if (typeof ResizeObserver === "function") new ResizeObserver(sizeChanged).observe(document.body);

  request("ui/initialize", {
    protocolVersion: "2025-06-18",
    appInfo: { name: "DogPolicies trip card", version: VERSION },
    appCapabilities: { availableDisplayModes: ["inline"] }
  }).then(function (r) {
    applyContext(r && r.hostContext);
    notify("ui/notifications/initialized", {});
  }, function () {
    notify("ui/notifications/initialized", {});
  });
})();
</script>
</body>
</html>`;

/** The card as an MCP resource: listed once, read by the host when a tool that declares it is called. */
export function cardResource(version) {
  const text = html(version);
  return {
    name: "trip-card",
    uri: CARD_URI,
    title: "DogPolicies trip card",
    description:
      "An interactive card for trip plans, nearby places, road-trip stops and emergency vets: each place's dog rule, a dot map from the records' own coordinates, and links to the pages. MCP Apps hosts draw it beside the answer.",
    mimeType: CARD_MIME,
    // No outside connections or resources: the defaults stand. A border reads as a card in both hosts.
    uiMeta: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } },
    read: () => ({ text }),
  };
}

/** For tests: the HTML with a given version. */
export const cardHtml = html;
