// `dogpolicies-mcp install`: puts the server into an AI client's configuration
// the way a careful person would. Finds the client's file on Windows, macOS
// and Linux; creates the file or the `mcpServers` key when missing; merges one
// entry without touching anything else; writes a timestamped backup first;
// refuses a file it cannot parse instead of overwriting it; does the same
// thing twice without changing anything; needs no admin rights; and prints
// the exact restart step for that client.
//
// Everything that decides is pure (planInstall) and testable with a fake
// platform, home and environment; only applyPlan touches the disk.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { DEFAULT_BASE_URL, PACKAGE_NAME, REMOTE_MCP_PATH } from "../config.mjs";

export const SERVER_KEY = "dogpolicies";
export const HOSTED_URL = `${DEFAULT_BASE_URL}${REMOTE_MCP_PATH}`;

/**
 * On Windows, Claude Desktop, Cursor and the others spawn the command without
 * a shell, and `npx` is `npx.cmd`, a batch file, so "spawn npx ENOENT" is the
 * most reported MCP error on Windows. `cmd /c npx ...` is the form that works
 * (Node 18.20+ also refuses to spawn a .cmd directly without a shell).
 */
export function stdioCommand(platform) {
  const npx = ["npx", "-y", PACKAGE_NAME];
  return platform === "win32"
    ? { command: "cmd", args: ["/c", ...npx] }
    : { command: "npx", args: ["-y", PACKAGE_NAME] };
}

const home = (env, fallback) =>
  env.DOGPOLICIES_HOME_FOR_TESTS ??
  env.HOME ??
  env.USERPROFILE ??
  fallback ??
  homedir();

/** Every client this command knows, with where its file lives and what it expects. */
export const CLIENTS = {
  "claude-desktop": {
    label: "Claude Desktop",
    key: "mcpServers",
    configPath: ({ platform, env, homeDir }) => {
      if (platform === "win32")
        return join(
          env.APPDATA ?? join(homeDir, "AppData", "Roaming"),
          "Claude",
          "claude_desktop_config.json",
        );
      if (platform === "darwin")
        return join(
          homeDir,
          "Library",
          "Application Support",
          "Claude",
          "claude_desktop_config.json",
        );
      return join(
        env.XDG_CONFIG_HOME ?? join(homeDir, ".config"),
        "Claude",
        "claude_desktop_config.json",
      );
    },
    stdio: (platform) => stdioCommand(platform),
    // Claude Desktop adds remote servers through its own UI, not the file.
    hosted: null,
    hostedSteps: [
      "Claude Desktop and claude.ai connect to the hosted server through the app, not a file:",
      "  Settings > Connectors > Add custom connector",
      `  Name: DogPolicies    URL: ${HOSTED_URL}`,
      "  Then turn it on in the chat's tools menu. Nothing to install, no Node.js needed.",
    ],
    restart: (platform) =>
      platform === "win32"
        ? "Fully quit Claude Desktop: right-click the Claude icon in the system tray (bottom right, near the clock) and choose Quit, then open Claude again. Closing the window is not enough."
        : platform === "darwin"
          ? "Fully quit Claude Desktop: Claude menu > Quit Claude (Cmd+Q), then open it again. Closing the window is not enough."
          : "Fully quit Claude Desktop and open it again.",
    logs: (platform) =>
      platform === "win32"
        ? "%APPDATA%\\Claude\\logs\\mcp.log and mcp-server-dogpolicies.log"
        : platform === "darwin"
          ? "~/Library/Logs/Claude/mcp.log and mcp-server-dogpolicies.log"
          : "~/.config/Claude/logs/",
  },
  cursor: {
    label: "Cursor",
    key: "mcpServers",
    configPath: ({ homeDir }) => join(homeDir, ".cursor", "mcp.json"),
    stdio: (platform) => stdioCommand(platform),
    hosted: () => ({ url: HOSTED_URL }),
    restart: () =>
      "Open Cursor Settings > MCP (or Customize in the sidebar); the server appears there. Toggle it on if it is off, or restart Cursor.",
    logs: () => "Cursor: Output panel (Ctrl+Shift+U / Cmd+Shift+U) > MCP Logs",
  },
  vscode: {
    label: "VS Code (Copilot)",
    key: "mcpServers",
    // The portable Copilot file is what VS Code's guided flow calls "Global >
    // Copilot Global"; the Copilot CLI reads it too. The profile mcp.json
    // (`servers` key) is the older form; `code --add-mcp` writes that one.
    configPath: ({ env, homeDir }) =>
      join(env.COPILOT_HOME ?? join(homeDir, ".copilot"), "mcp-config.json"),
    stdio: (platform) => stdioCommand(platform),
    hosted: () => ({ type: "http", url: HOSTED_URL }),
    cli: (platform, hosted) =>
      hosted
        ? `code --add-mcp "{\\"name\\":\\"dogpolicies\\",\\"type\\":\\"http\\",\\"url\\":\\"${HOSTED_URL}\\"}"`
        : `code --add-mcp "{\\"name\\":\\"dogpolicies\\",\\"type\\":\\"stdio\\",\\"command\\":\\"${stdioCommand(platform).command}\\",\\"args\\":${JSON.stringify(stdioCommand(platform).args).replaceAll('"', '\\"')}}"`,
    restart: () =>
      "In VS Code run MCP: List Servers from the command palette and start dogpolicies, or reload the window (Developer: Reload Window).",
    logs: () =>
      "VS Code: command palette > MCP: List Servers > dogpolicies > Show Output",
  },
  windsurf: {
    label: "Windsurf",
    key: "mcpServers",
    configPath: ({ homeDir }) =>
      join(homeDir, ".codeium", "windsurf", "mcp_config.json"),
    stdio: (platform) => stdioCommand(platform),
    hosted: () => ({ serverUrl: HOSTED_URL }),
    restart: () =>
      "In Windsurf open the Cascade MCP panel and press Refresh, or restart Windsurf.",
    logs: () => "Windsurf: Output panel > Windsurf MCP",
  },
  "claude-code": {
    label: "Claude Code",
    // Claude Code has a CLI; the command is the right way in, not its file.
    command: (platform, hosted) =>
      hosted
        ? [
            "claude",
            "mcp",
            "add",
            "--scope",
            "user",
            "--transport",
            "http",
            SERVER_KEY,
            HOSTED_URL,
          ]
        : [
            "claude",
            "mcp",
            "add",
            "--scope",
            "user",
            SERVER_KEY,
            "--",
            ...[stdioCommand(platform).command, ...stdioCommand(platform).args],
          ],
    removeCommand: () => [
      "claude",
      "mcp",
      "remove",
      "--scope",
      "user",
      SERVER_KEY,
    ],
    restart: () =>
      "Start a new Claude Code session; `claude mcp list` shows dogpolicies.",
    logs: () => "Claude Code: `claude mcp list`, or run with --mcp-debug",
  },
};

export const CLIENT_IDS = Object.keys(CLIENTS);

/** Pretty JSON the way the clients write it. */
const pretty = (obj) => JSON.stringify(obj, null, 2) + "\n";

/**
 * Decides what to do for one client without touching the disk.
 *
 * @param {object} o
 * @param {string} o.client one of CLIENT_IDS
 * @param {boolean} [o.hosted] write the remote URL form where the client supports it
 * @param {boolean} [o.uninstall]
 * @param {string} [o.platform] process.platform by default
 * @param {object} [o.env] process.env by default
 * @param {string} [o.homeDir]
 * @param {() => Date} [o.now]
 * @returns {object} a plan: { kind: "file" | "command" | "steps" | "noop" | "error", ... }
 */
export function planInstall({
  client,
  hosted = false,
  uninstall = false,
  platform = process.platform,
  env = process.env,
  homeDir,
  now = () => new Date(),
}) {
  const spec = CLIENTS[client];
  if (!spec)
    return {
      kind: "error",
      client,
      message: `Unknown client "${client}". Known: ${CLIENT_IDS.join(", ")}.`,
    };
  const h = homeDir ?? home(env);
  const base = {
    client,
    label: spec.label,
    hosted,
    uninstall,
    restart: spec.restart(platform),
    logs: spec.logs(platform),
  };

  if (spec.command) {
    const argv = uninstall
      ? spec.removeCommand()
      : spec.command(platform, hosted);
    return {
      ...base,
      kind: "command",
      argv,
      display: argv
        .map((a) => (/\s/.test(a) ? JSON.stringify(a) : a))
        .join(" "),
    };
  }
  if (hosted && !spec.hosted)
    return { ...base, kind: "steps", steps: spec.hostedSteps };

  const path = spec.configPath({ platform, env, homeDir: h });
  let current = null;
  let existed = false;
  if (existsSync(path)) {
    existed = true;
    const text = readFileSync(path, "utf8");
    if (text.trim() === "") current = {};
    else {
      try {
        current = JSON.parse(text);
      } catch (error) {
        return {
          ...base,
          kind: "error",
          path,
          message: `${spec.label}'s config at ${path} is not valid JSON (${error.message}). Nothing was changed. Open the file, fix the syntax (a stray comma is the usual cause) or move it aside, then run this again.`,
        };
      }
      if (!current || typeof current !== "object" || Array.isArray(current))
        return {
          ...base,
          kind: "error",
          path,
          message: `${path} does not contain a JSON object. Nothing was changed.`,
        };
    }
  }
  const next = structuredClone(current ?? {});
  const key = spec.key;
  if (
    next[key] !== undefined &&
    (typeof next[key] !== "object" || Array.isArray(next[key]))
  )
    return {
      ...base,
      kind: "error",
      path,
      message: `${path} has a "${key}" that is not an object. Nothing was changed.`,
    };
  const entry = hosted ? spec.hosted() : spec.stdio(platform);
  if (uninstall) {
    if (!next[key]?.[SERVER_KEY])
      return {
        ...base,
        kind: "noop",
        path,
        message: `${spec.label} has no "${SERVER_KEY}" entry; nothing to remove.`,
      };
    delete next[key][SERVER_KEY];
  } else {
    next[key] ??= {};
    if (JSON.stringify(next[key][SERVER_KEY]) === JSON.stringify(entry))
      return {
        ...base,
        kind: "noop",
        path,
        entry,
        message: `${spec.label} already has this exact "${SERVER_KEY}" entry in ${path}; nothing changed.`,
      };
    next[key][SERVER_KEY] = entry;
  }
  const stamp = now().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return {
    ...base,
    kind: "file",
    path,
    existed,
    entry: uninstall ? null : entry,
    before: current,
    after: next,
    text: pretty(next),
    backupPath: existed ? `${path}.${stamp}.bak` : null,
  };
}

/** Writes a "file" plan: backup first, then the merged file. Creates folders. */
export function applyPlan(plan) {
  if (plan.kind !== "file") return plan;
  mkdirSync(dirname(plan.path), { recursive: true });
  if (plan.backupPath) copyFileSync(plan.path, plan.backupPath);
  writeFileSync(plan.path, plan.text);
  return { ...plan, written: true };
}

/** Which clients look present on this machine (their folder exists). */
export function detectClients({
  platform = process.platform,
  env = process.env,
  homeDir,
} = {}) {
  const h = homeDir ?? home(env);
  const found = [];
  for (const [id, spec] of Object.entries(CLIENTS)) {
    if (spec.command) continue;
    const dir = dirname(spec.configPath({ platform, env, homeDir: h }));
    if (existsSync(dir)) found.push(id);
  }
  return found;
}

/** The whole command: plan, apply (unless dry run), print. Returns the exit code. */
export function runInstall(
  { clients, hosted = false, dryRun = false, uninstall = false, all = false },
  {
    platform = process.platform,
    env = process.env,
    homeDir,
    print = (s) => process.stdout.write(s + "\n"),
    run = spawnSync,
  } = {},
) {
  let targets = clients;
  if (!targets?.length) {
    const detected = detectClients({ platform, env, homeDir });
    if (all) targets = detected.length ? detected : ["claude-desktop"];
    else {
      targets = [
        detected.includes("claude-desktop") || !detected.length
          ? "claude-desktop"
          : detected[0],
      ];
      print(
        `No --client given; ${detected.length ? `found ${detected.join(", ")}; ` : ""}installing for ${CLIENTS[targets[0]].label}. Others: --client ${CLIENT_IDS.filter((c) => c !== targets[0]).join(" | ")}, or --all.`,
      );
    }
  }
  let failed = 0;
  for (const client of targets) {
    const plan = planInstall({
      client,
      hosted,
      uninstall,
      platform,
      env,
      homeDir,
    });
    print("");
    print(`== ${plan.label ?? client} ==`);
    if (plan.kind === "error") {
      failed++;
      print(`Refused: ${plan.message}`);
      continue;
    }
    if (plan.kind === "steps") {
      for (const s of plan.steps) print(s);
      continue;
    }
    if (plan.kind === "noop") {
      print(plan.message);
      print(`Restart step, in case it is not showing yet: ${plan.restart}`);
      continue;
    }
    if (plan.kind === "command") {
      print(`${dryRun ? "Would run" : "Running"}: ${plan.display}`);
      if (!dryRun) {
        const r = run(plan.argv[0], plan.argv.slice(1), {
          stdio: "inherit",
          shell: platform === "win32",
        });
        if (r.error || r.status !== 0) {
          failed++;
          print(
            `Could not run the claude CLI (${r.error?.message ?? `exit ${r.status}`}). Install Claude Code or run the command above yourself.`,
          );
          continue;
        }
      }
      print(`Then: ${plan.restart}`);
      continue;
    }
    // file
    print(
      `${plan.uninstall ? "Removing" : "Adding"} "${SERVER_KEY}" ${plan.uninstall ? "from" : "to"} ${plan.path}${plan.existed ? "" : " (new file)"}`,
    );
    if (plan.entry) print(`Entry: ${JSON.stringify(plan.entry)}`);
    if (plan.backupPath) print(`Backup: ${plan.backupPath}`);
    if (dryRun) {
      print("Dry run: nothing written. The file would be:");
      print(plan.text.trimEnd());
    } else {
      applyPlan(plan);
      print("Written. Other settings in the file were left as they were.");
      const cli = CLIENTS[client].cli;
      if (cli && !plan.uninstall)
        print(`VS Code's own format instead: ${cli(platform, hosted)}`);
    }
    print(`Next: ${plan.restart}`);
    print(`Logs if it does not show up: ${plan.logs}`);
  }
  print("");
  print(
    failed
      ? `${failed} client${failed === 1 ? "" : "s"} not configured; see above.`
      : `Done. Try it: npx ${PACKAGE_NAME} check`,
  );
  return failed ? 1 : 0;
}
