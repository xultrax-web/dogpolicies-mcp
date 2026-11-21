// 0.6.0: the emergency-vet tool, the nearest 24-hour hospital beside near / plan_trip / route_stops, and
// the trip card (MCP Apps): declared on four tools, served as a ui:// resource with no outside requests.
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { call, withClient } from "./helpers.mjs";
import { CARD_MIME, CARD_URI, cardHtml } from "../src/dogpolicies/ui/trip-card.mjs";

test("emergency_vet lists the nearest hospitals with phone, service and distance, nearest first", async () => {
  await withClient(async (c) => {
    const r = await call(c, "dogpolicies_emergency_vet", { place: "Sacramento", limit: 4 });
    const vets = r.structuredContent.vets;
    assert.equal(vets.length, 4);
    for (const v of vets) {
      assert.ok(v.phone && v.address && v.source_url && v.verified_at);
      assert.ok(["24_7", "emergency_hours"].includes(v.emergency));
    }
    const d = vets.map((v) => v.distance_miles);
    assert.deepEqual(d, [...d].sort((a, b) => a - b));
    assert.match(r.content[0].text, /not medical advice/);
  });
});

test("open_24h_only keeps 24-hour hospitals; a far place still names the nearest 24-hour one", async () => {
  await withClient(async (c) => {
    const only = await call(c, "dogpolicies_emergency_vet", { place: "Kettleman City", open_24h_only: true });
    assert.ok(only.structuredContent.vets.every((v) => v.emergency === "24_7"));
    const far = await call(c, "dogpolicies_emergency_vet", { place: "Markleeville", radius_miles: 10 });
    assert.equal(far.structuredContent.outcome, "no_match");
    assert.ok(far.structuredContent.nearest_24h, "nearest 24-hour hospital at any distance");
    assert.equal(far.structuredContent.nearest_24h.state, "NV");
  });
});

test("near, plan_trip and route_stops carry the nearest 24-hour emergency vet", async () => {
  await withClient(async (c) => {
    const n = await call(c, "dogpolicies_near", { place: "Markleeville" });
    assert.equal(n.structuredContent.vet.emergency, "24_7");
    assert.match(n.content[0].text, /Nearest 24-hour emergency vet/);
    const p = await call(c, "dogpolicies_plan_trip", { place: "South Lake Tahoe" });
    assert.equal(p.structuredContent.vet.emergency, "24_7");
    const r = await call(c, "dogpolicies_route_stops", { route: "i-5", near: { lat: 36.0, lon: -119.96 }, direction: "north", ahead_miles: 80 });
    assert.ok(r.structuredContent.vets.length >= 1);
  });
});

test("the trip card is declared on four tools and served as an MCP Apps resource", async () => {
  await withClient(async (c) => {
    const { tools } = await c.listTools();
    const withCard = tools.filter((t) => t._meta?.ui?.resourceUri === CARD_URI).map((t) => t.name).sort();
    assert.deepEqual(withCard, ["dogpolicies_emergency_vet", "dogpolicies_near", "dogpolicies_plan_trip", "dogpolicies_route_stops"]);
    for (const t of tools.filter((x) => x._meta?.ui)) assert.equal(t._meta["ui/resourceUri"], CARD_URI);
    const { resources } = await c.listResources();
    assert.ok(resources.some((r) => r.uri === CARD_URI && r.mimeType === CARD_MIME));
    const read = await c.readResource({ uri: CARD_URI });
    assert.equal(read.contents[0].mimeType, "text/html;profile=mcp-app");
    assert.equal(read.contents[0]._meta.ui.prefersBorder, true);
    assert.match(read.contents[0].text, /ui\/initialize/);
  });
});

test("the card makes no outside request and puts results in as text", () => {
  const html = cardHtml("test");
  const script = html.slice(html.indexOf("<script>") + 8, html.lastIndexOf("</script>"));
  assert.doesNotThrow(() => new Function(script));
  assert.ok(!/\bfetch\(|XMLHttpRequest|WebSocket|<script[^>]+src=|<link[^>]+href=|@import/.test(html));
  assert.ok(!/innerHTML/.test(script), "no markup from data");
  assert.match(script, /ui\/notifications\/tool-result/);
  assert.match(script, /ui\/open-link/);
  assert.match(script, /protocolVersion: "2025-06-18"/);
});
