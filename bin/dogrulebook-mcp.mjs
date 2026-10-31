#!/usr/bin/env node
// Dog Rulebook MCP server. No configuration needed: the data ships inside.
//
//   npx dogrulebook-mcp                 stdio (Claude Desktop, Claude Code, Cursor, VS Code)
//   npx dogrulebook-mcp --http          Streamable HTTP on http://127.0.0.1:3737/mcp
//   npx dogrulebook-mcp demo "Monterey" one real answer in the terminal, with its citation
//   npx dogrulebook-mcp check           load the data and run every tool once
//
// Options: --offline, --base-url <url>, --port <n>, --host <name>, --log <level>

import { serveStdio } from "@modelcontextprotocol/server/stdio";
import {
  ENV,
  PACKAGE_NAME,
  PACKAGE_VERSION,
  REMOTE_MCP_PATH,
  DEFAULT_BASE_URL,
} from "../src/config.mjs";
import { createHttpHandler, listen } from "../src/core/http.mjs";
import { createRuntime, createServer } from "../src/dogrulebook/server.mjs";

const HELP = `${PACKAGE_NAME} ${PACKAGE_VERSION}
Verified dog rules for California and Nevada travel, as an MCP server.

Usage
  ${PACKAGE_NAME}                      serve over stdio (the default for AI clients)
  ${PACKAGE_NAME} --http [--port N]    serve over Streamable HTTP on localhost
  ${PACKAGE_NAME} demo [query]         print one cited answer to the terminal
  ${PACKAGE_NAME} check                load the data and call every tool once
  ${PACKAGE_NAME} --version | --help

Options
  --offline            never use the network (no data refresh, no reports)
  --base-url <url>     site to refresh data from and file reports to
                       (default ${DEFAULT_BASE_URL}; env ${ENV.baseUrl})
  --port <n>           HTTP port (default 3737)   --host <name>  (default 127.0.0.1)
  --log <level>        silent | error | warn | info | debug (env ${ENV.log})

No telemetry. The only network calls are a data refresh from the base URL and
the corrections you file with dogrulebook_report_correction.
Hosted alternative (no install): ${DEFAULT_BASE_URL}${REMOTE_MCP_PATH}
`;

function parseArgs(argv) {
  const out = {
    command: "stdio",
    port: 3737,
    host: "127.0.0.1",
    overrides: {},
    rest: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--help" || a === "-h") out.command = "help";
    else if (a === "--version" || a === "-v") out.command = "version";
    else if (a === "--http") out.command = "http";
    else if (a === "--stdio") out.command = "stdio";
    else if (a === "demo" || a === "check") out.command = a;
    else if (a === "--offline") out.overrides.offline = true;
    else if (a === "--base-url") out.overrides.baseUrl = next();
    else if (a === "--log") out.overrides.logLevel = next();
    else if (a === "--port") out.port = Number(next());
    else if (a === "--host") out.host = next();
    else if (a.startsWith("--")) {
      process.stderr.write(`unknown option ${a}\n${HELP}`);
      process.exit(2);
    } else out.rest.push(a);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

if (args.command === "help") {
  process.stdout.write(HELP);
  process.exit(0);
}
if (args.command === "version") {
  process.stdout.write(`${PACKAGE_VERSION}\n`);
  process.exit(0);
}

let ctx;
try {
  ctx = createRuntime({ overrides: args.overrides });
} catch (error) {
  process.stderr.write(`${PACKAGE_NAME}: ${error.message}\n`);
  process.exit(2);
}
const { log } = ctx;

if (args.command === "stdio") {
  serveStdio(() => createServer(ctx), { onerror: (e) => log.warn(e.message) });
  log.info(
    `${PACKAGE_VERSION} on stdio: ${ctx.graph.places.length} places, data of ${ctx.graph.as_of} (${ctx.source.origin})`,
  );
  // Refresh in the background; a failure changes nothing.
  ctx.source.refresh();
} else if (args.command === "http") {
  const handler = createHttpHandler(() => createServer(ctx), { log });
  const { url } = await listen(handler, {
    port: args.port,
    host: args.host,
    log,
  });
  log.info(
    `${PACKAGE_VERSION} on ${url}: ${ctx.graph.places.length} places, data of ${ctx.graph.as_of}`,
  );
  ctx.source.refresh();
} else {
  const { runCheck, runDemo } = await import("../src/dogrulebook/cli.mjs");
  const code =
    args.command === "check"
      ? await runCheck(ctx)
      : await runDemo(ctx, args.rest.join(" "));
  process.exit(code);
}
