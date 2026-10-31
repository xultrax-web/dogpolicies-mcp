// Shared test setup: an offline runtime with a pinned date and a silent log,
// so every test is reproducible and never touches the network.

import { createRuntime } from "../src/dogrulebook/server.mjs";
import { connectInProcess } from "../src/dogrulebook/connect.mjs";

export const TODAY = "2026-10-31";

export function testRuntime(overrides = {}) {
  return createRuntime({
    env: {},
    overrides: {
      offline: true,
      logLevel: "silent",
      today: () => TODAY,
      ...overrides,
    },
  });
}

let shared;
/** One runtime for the whole test process; loading the snapshot once is enough. */
export function sharedRuntime() {
  return (shared ??= testRuntime());
}

export async function withClient(fn, ctx = sharedRuntime()) {
  const { client, close } = await connectInProcess(ctx);
  try {
    return await fn(client, ctx);
  } finally {
    await close();
  }
}

export const call = (client, name, args = {}) =>
  client.callTool({ name, arguments: args });
export const text = (r) => r.content[0].text;
