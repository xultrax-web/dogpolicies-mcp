// The HTTP operations (R-26) over the package alone: every read-only tool is
// an operation, the query is parsed by the tool's own input schema, and the
// answer is the MCP answer. The Worker's transport part is tested in the
// site's tests/rest.test.mjs; nothing here imports from worker/.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  createRestApi,
  operationSlug,
  parseQuery,
  restOpenApi,
  toolDefinitions,
} from "../src/index.mjs";
import { inputJsonSchema } from "../src/dogpolicies/rest.mjs";
import { call, sharedRuntime, withClient } from "./helpers.mjs";

const q = (s) => new URLSearchParams(s);

test("rest: one operation per read-only tool, none for the write", () => {
  const ctx = sharedRuntime();
  const api = createRestApi(ctx);
  const readOnly = toolDefinitions(ctx).filter(
    (t) => t.annotations.readOnlyHint === true,
  );
  assert.deepEqual(
    [...api.operations.keys()].sort(),
    readOnly.map((t) => operationSlug(t.name)).sort(),
  );
  assert.ok(!api.operations.has("report-correction"));
  const { paths } = restOpenApi(ctx);
  for (const t of readOnly)
    assert.equal(
      paths[`/ask/${operationSlug(t.name)}`].get.operationId,
      t.name,
    );
});

test("rest: the query is read by the schema (numbers, booleans, lists, near.lat)", () => {
  const ctx = sharedRuntime();
  const near = toolDefinitions(ctx).find((t) => t.name === "dogpolicies_near");
  assert.deepEqual(
    parseQuery(
      inputJsonSchema(near),
      q(
        "near.lat=36.6&near.lon=-121.9&dogs_allowed_only=false&per_type=2&types=beach,park",
      ),
    ),
    {
      near: { lat: 36.6, lon: -121.9 },
      dogs_allowed_only: false,
      per_type: 2,
      types: ["beach", "park"],
    },
  );
  // a hostile key never reaches Object.prototype
  parseQuery(inputJsonSchema(near), q("__proto__.polluted=1"));
  assert.equal({}.polluted, undefined);
});

test("rest: 400 with issues for bad input, 404 listing for an unknown operation, 200 for a miss", async () => {
  const api = createRestApi(sharedRuntime());
  const bad = await api.run("near", q("place=Carmel&radius_miles=9999"));
  assert.equal(bad.status, 400);
  assert.ok(bad.body.issues.length);
  const unknown = await api.run("book-a-room", q(""));
  assert.equal(unknown.status, 404);
  assert.ok(unknown.body.operations.includes("near"));
  const miss = await api.run("near", q("place=Nowheresville Zz"));
  assert.equal(miss.status, 200);
  assert.equal(miss.body.outcome, "no_match");
});

test("rest: the answer equals the MCP answer", async () => {
  const ctx = sharedRuntime();
  const api = createRestApi(ctx);
  await withClient(async (client) => {
    const rest = await api.run("near", q("place=Van Nuys"));
    const mcp = await call(client, "dogpolicies_near", { place: "Van Nuys" });
    assert.deepEqual(rest.body, mcp.structuredContent);
    const route = await api.run(
      "route-stops",
      q("route=i-5&from_mile=200&to_mile=222&direction=north&kinds=park"),
    );
    const viaMcp = await call(client, "dogpolicies_route_stops", {
      route: "i-5",
      from_mile: 200,
      to_mile: 222,
      direction: "north",
      kinds: ["park"],
    });
    assert.deepEqual(route.body, viaMcp.structuredContent);
  }, ctx);
});
