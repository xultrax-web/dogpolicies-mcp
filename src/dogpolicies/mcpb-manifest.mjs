// The manifest for the Claude Desktop extension (.mcpb, "Desktop Extensions"),
// built from the live package so the tool list, version and description can
// never drift from the server. Spec: github.com/anthropics/mcpb MANIFEST.md,
// manifest_version 0.3.

import { createRequire } from "node:module";
import { BRAND, PACKAGE_NAME, PACKAGE_VERSION } from "../config.mjs";
import { toolDefinitions } from "./server.mjs";
import { prompts } from "./prompts.mjs";

const pkg = createRequire(import.meta.url)("../../package.json");

export const MANIFEST_VERSION = "0.3";

/**
 * @param {object} ctx a runtime (createRuntime), for the tool and prompt lists
 * @returns {object} manifest.json contents
 */
export function buildManifest(ctx) {
  const tools = toolDefinitions(ctx).map((t) => ({
    name: t.name,
    description: t.description.split("\n")[0].trim(),
  }));
  const promptList = prompts(ctx).map((p) => ({
    name: p.name,
    description: p.description,
    arguments: Object.keys(p.argsSchema ?? {}),
  }));
  return {
    manifest_version: MANIFEST_VERSION,
    name: PACKAGE_NAME,
    display_name: BRAND.name,
    version: PACKAGE_VERSION,
    description:
      "Verified dog rules for California and Nevada travel, with the official source and date on every answer.",
    long_description: [
      `Ask Claude whether dogs are allowed at ${ctx.graph.places.length.toLocaleString("en-US")} California and Nevada parks, beaches, trails, hotels, campgrounds and restaurant patios, which hotel will take your dog (weight, number of dogs, nights, pet-fee budget, with the fee math shown), what to do near a town, and where to stop on a highway.`,
      "",
      'Every fact comes from an official source (the agency page or the business\'s own policy) with the date it was checked, and every answer carries a citation. When a source does not state something, the answer says "not stated" instead of guessing.',
      "",
      "The data ships inside the extension and works offline; it refreshes itself from dogpolicies.com when the site has a newer snapshot. No account, no key, no telemetry. Code MIT; data CC BY 4.0.",
    ].join("\n"),
    author: { name: BRAND.name, url: BRAND.url },
    repository: { type: "git", url: pkg.repository.url.replace(/^git\+/, "") },
    homepage: `${BRAND.url}/mcp/about/`,
    documentation: `${pkg.homepage}`,
    support: pkg.bugs.url,
    icon: "icon.png",
    server: {
      type: "node",
      entry_point: "bin/dogpolicies-mcp.mjs",
      mcp_config: {
        command: "node",
        args: ["${__dirname}/bin/dogpolicies-mcp.mjs"],
        env: {},
      },
    },
    tools,
    tools_generated: false,
    // Prompt text is built from arguments at run time, so only names are declared.
    prompts: promptList.map(({ name, description, arguments: args }) => ({
      name,
      description,
      arguments: args,
      text: `Use the ${name} prompt from the DogPolicies server${args.length ? ` with ${args.map((a) => `\${arguments.${a}}`).join(", ")}` : ""}.`,
    })),
    prompts_generated: false,
    keywords: [
      "dogs",
      "pet-friendly",
      "travel",
      "hotels",
      "beaches",
      "parks",
      "california",
      "nevada",
      "pet policy",
    ],
    license: pkg.license,
    privacy_policies: [`${BRAND.url}/terms/`],
    compatibility: {
      claude_desktop: ">=0.10.0",
      platforms: ["darwin", "win32", "linux"],
      runtimes: { node: ">=20.19.0" },
    },
  };
}
