// The trip card (roadmap R-27, release 0.6.0): an MCP Apps view (io.modelcontextprotocol/ui, the
// ext-apps specification) that Claude and ChatGPT draw beside the answers of the tools that declare it
// (plan_trip, near, route_stops, emergency_vet). One self-contained HTML document: no framework, no
// request leaves the frame (the default CSP stands), every value from the tool result is set as text,
// never as markup. Links open through the host (ui/open-link). Clients without MCP Apps never see it;
// the tool's text answer is unchanged.
//
// The script inside is plain ES5-style JavaScript in a String.raw template, so it must contain no
// backticks and no dollar-brace sequences.

import { BASEMAP } from "./basemap-data.mjs";

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
.map { display: block; width: 100%; height: auto; margin: 4px 0 6px; border-radius: var(--border-radius-md, 8px); overflow: hidden; }
.map .sea { fill: light-dark(#cfe2ea, #11262e); }
.map .land { fill: light-dark(#f3efe4, #1c2520); }
.map .water { fill: light-dark(#cfe2ea, #11262e); stroke: light-dark(#a9c7d4, #234350); stroke-width: .6; }
.map .border { fill: none; stroke: light-dark(#a39b8c, #56635b); stroke-width: 1; stroke-dasharray: 5 3; }
.map .road { fill: none; stroke-linecap: round; stroke-linejoin: round; }
.map .r1 { stroke: light-dark(#8a8274, #9aa69e); stroke-width: 2.4; }
.map .r2 { stroke: light-dark(#a49c8d, #7f8b84); stroke-width: 1.7; }
.map .r3 { stroke: light-dark(#bdb5a6, #5f6b64); stroke-width: 1.2; }
.map .lbl { font-size: 11px; paint-order: stroke; stroke-width: 3px; stroke-linejoin: round; }
.map .water-lbl { fill: light-dark(#3d6d80, #8fbccc); stroke: light-dark(#cfe2ea, #11262e); font-style: italic; }
.map .road-lbl { fill: light-dark(#4a453c, #c9d2cc); stroke: light-dark(#f3efe4, #1c2520); font-weight: 600; font-size: 10px; }
.map .center { stroke: light-dark(#0a1f17, #e6efe9); }
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
  var BASE = ${JSON.stringify(BASEMAP)};
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

  // The map: land, water and highways from the U.S. Census Bureau (public domain), embedded in this card
  // (BASE, from basemap-data.mjs), with the records' own places on top. No tiles, no outside request.
  var decoded = null;
  function decodeLine(s) {
    var pts = [], i = 0, lat = 0, lon = 0, q = BASE.q;
    var minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
    while (i < s.length) {
      var b, shift = 0, res = 0;
      do { b = s.charCodeAt(i++) - 63; res |= (b & 31) << shift; shift += 5; } while (b >= 32);
      lat += (res & 1) ? ~(res >> 1) : (res >> 1);
      shift = 0; res = 0;
      do { b = s.charCodeAt(i++) - 63; res |= (b & 31) << shift; shift += 5; } while (b >= 32);
      lon += (res & 1) ? ~(res >> 1) : (res >> 1);
      var y = lat / q, x = lon / q;
      pts.push(x, y);
      if (x < minx) minx = x;
      if (x > maxx) maxx = x;
      if (y < miny) miny = y;
      if (y > maxy) maxy = y;
    }
    return { p: pts, b: [minx, miny, maxx, maxy] };
  }
  function base() {
    if (decoded) return decoded;
    function all(list, key) {
      var out = [];
      list.forEach(function (f) { f[key].forEach(function (s) { out.push({ f: f, g: decodeLine(s) }); }); });
      return out;
    }
    decoded = { land: all(BASE.land, "r"), water: all(BASE.water, "r"), roads: all(BASE.roads, "l") };
    return decoded;
  }

  function dotMap(points, center) {
    var pts = points.filter(function (p) { return p && p.geo && typeof p.geo.lat === "number"; });
    if (!pts.length || (pts.length < 2 && !center)) return null;
    var lats = pts.map(function (p) { return p.geo.lat; }), lons = pts.map(function (p) { return p.geo.lon; });
    if (center) { lats.push(center.lat); lons.push(center.lon); }
    var minLat = Math.min.apply(null, lats), maxLat = Math.max.apply(null, lats);
    var minLon = Math.min.apply(null, lons), maxLon = Math.max.apply(null, lons);
    var midLat = (minLat + maxLat) / 2, midLon = (minLon + maxLon) / 2;
    var k = Math.cos(midLat * Math.PI / 180);
    var w = 600, h = 260, pad = 26;
    // At least about 9 km of ground across, so a town's places sit in their surroundings.
    var spanX = Math.max((maxLon - minLon) * k, 0.08), spanY = Math.max(maxLat - minLat, 0.03);
    var s = Math.min((w - 2 * pad) / spanX, (h - 2 * pad) / spanY);
    function xy(lat, lon) { return [w / 2 + (lon - midLon) * k * s, h / 2 - (lat - midLat) * s]; }
    var L = midLon - w / 2 / (k * s), R = midLon + w / 2 / (k * s), B = midLat - h / 2 / s, T = midLat + h / 2 / s;
    function seen(bb) { return !(bb[2] < L || bb[0] > R || bb[3] < B || bb[1] > T); }
    function d(p, close) {
      var out = "";
      for (var i = 0; i < p.length; i += 2) {
        var q = xy(p[i + 1], p[i]);
        out += (i ? "L" : "M") + q[0].toFixed(1) + " " + q[1].toFixed(1);
      }
      return close ? out + "Z" : out;
    }
    var NS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 " + w + " " + h);
    svg.setAttribute("class", "map");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Map of the places listed below, with the coast, lakes and highways");
    function add(tag, attrs) {
      var n = document.createElementNS(NS, tag);
      for (var a in attrs) if (attrs.hasOwnProperty(a)) n.setAttribute(a, attrs[a]);
      svg.appendChild(n);
      return n;
    }
    function layer(path, cls) { if (path) add("path", { d: path, "class": cls }); }
    var g = base();
    add("rect", { x: 0, y: 0, width: w, height: h, "class": "sea" });
    var land = "", border = "", water = "", lakes = [];
    g.land.forEach(function (x) {
      if (!seen(x.g.b)) return;
      var p = d(x.g.p, true);
      land += p;
      if (x.f.s !== "CA") border += p;
    });
    layer(land, "land");
    g.water.forEach(function (x) {
      if (!seen(x.g.b)) return;
      water += d(x.g.p, true);
      if (x.f.a >= 8) lakes.push(x);
    });
    layer(water, "water");
    layer(border, "border");
    var shields = [];
    [3, 2, 1].forEach(function (kind) {
      var path = "";
      g.roads.forEach(function (x) {
        if (x.f.k !== kind || !seen(x.g.b)) return;
        path += d(x.g.p, false);
        if (!x.f.n) return;
        // Where to name the road: the middle of its part inside the frame.
        var inside = [];
        for (var i = 0; i < x.g.p.length; i += 2) {
          var q = xy(x.g.p[i + 1], x.g.p[i]);
          if (q[0] > 40 && q[0] < w - 40 && q[1] > 16 && q[1] < h - 10) inside.push(q);
        }
        if (inside.length) shields.push({ n: x.f.n, k: kind, pts: inside, len: inside.length });
      });
      layer(path, "road r" + kind);
    });
    // Labels stay clear of each other and of the places' dots.
    var labels = [];
    var dots = pts.map(function (p) { return xy(p.geo.lat, p.geo.lon); });
    if (center) dots.push(xy(center.lat, center.lon));
    function free(at, half) {
      for (var i = 0; i < labels.length; i++) if (Math.abs(labels[i][0] - at[0]) < labels[i][2] + half + 6 && Math.abs(labels[i][1] - at[1]) < 16) return false;
      for (var j = 0; j < dots.length; j++) if (Math.abs(dots[j][0] - at[0]) < half + 8 && dots[j][1] - at[1] < 12 && at[1] - dots[j][1] < 20) return false;
      return true;
    }
    function label(text, at, cls) {
      var half = text.length * 3.2;
      if (!free(at, half)) return false;
      labels.push([at[0], at[1], half]);
      var t = add("text", { x: at[0].toFixed(1), y: at[1].toFixed(1), "class": cls, "text-anchor": "middle" });
      t.textContent = text;
      return true;
    }
    lakes.sort(function (a, b) { return b.f.a - a.f.a; });
    var named = {};
    lakes.forEach(function (x) {
      if (named[x.f.n] || Object.keys(named).length >= 2) return;
      var at = xy((x.g.b[1] + x.g.b[3]) / 2, (x.g.b[0] + x.g.b[2]) / 2);
      if (at[0] < 50 || at[0] > w - 50 || at[1] < 18 || at[1] > h - 8) return;
      named[x.f.n] = 1;
      label(x.f.n, at, "lbl water-lbl");
    });
    shields.sort(function (a, b) { return a.k - b.k || b.len - a.len; });
    var done = {};
    shields.forEach(function (x) {
      if (done[x.n] || Object.keys(done).length >= 4) return;
      // Try the middle of the road's part in the frame first, then points either side of it.
      var order = [0.5, 0.35, 0.65, 0.2, 0.8, 0.1, 0.9];
      for (var i = 0; i < order.length; i++) {
        if (label(x.n, x.pts[Math.floor((x.pts.length - 1) * order[i])], "lbl road-lbl")) { done[x.n] = 1; return; }
      }
    });
    var COLOR = { yes: "#0f6b47", yes_restricted: "#c98a12", no: "#b3261e", vet: "#6a4fc0" };
    if (center) svg.setAttribute("data-center", "1");
    if (center) {
      var c = xy(center.lat, center.lon);
      add("circle", { cx: c[0], cy: c[1], r: 7, fill: "none", "class": "center", "stroke-width": 2 });
    }
    pts.forEach(function (p, i) {
      var q = xy(p.geo.lat, p.geo.lon);
      var dot = add("circle", { cx: q[0], cy: q[1], r: 5, fill: COLOR[p._kind === "vet" ? "vet" : p.status] || "#2f4258", stroke: "white", "stroke-width": 1.5 });
      var t = document.createElementNS(NS, "title"); t.textContent = (i + 1) + ". " + p.name; dot.appendChild(t);
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
      "An interactive card for trip plans, nearby places, road-trip stops and emergency vets: each place's dog rule, a map of the places with the coast, lakes and highways, and links to the pages. MCP Apps hosts draw it beside the answer.",
    mimeType: CARD_MIME,
    // No outside connections or resources: the defaults stand. A border reads as a card in both hosts.
    uiMeta: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } },
    read: () => ({ text }),
  };
}

/** For tests: the HTML with a given version. */
export const cardHtml = html;
