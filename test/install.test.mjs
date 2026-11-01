// The installer, against temporary homes on every platform: creates the file
// or the key when missing, merges without touching other settings, backs up,
// is idempotent, refuses malformed JSON, uninstalls, and writes the Windows
// form that works (cmd /c npx).

import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  CLIENTS,
  CLIENT_IDS,
  HOSTED_URL,
  applyPlan,
  detectClients,
  planInstall,
  runInstall,
  stdioCommand,
} from "../src/dogpolicies/install.mjs";

const fresh = () => mkdtempSync(join(tmpdir(), "dp-install-"));
const envFor = (homeDir) => ({
  APPDATA: join(homeDir, "AppData", "Roaming"),
  HOME: homeDir,
  USERPROFILE: homeDir,
});
const now = () => new Date("2026-11-01T12:00:00Z");

test("Windows writes cmd /c npx; macOS and Linux write npx", () => {
  assert.deepEqual(stdioCommand("win32"), {
    command: "cmd",
    args: ["/c", "npx", "-y", "dogpolicies-mcp"],
  });
  assert.deepEqual(stdioCommand("darwin"), {
    command: "npx",
    args: ["-y", "dogpolicies-mcp"],
  });
  assert.deepEqual(stdioCommand("linux"), {
    command: "npx",
    args: ["-y", "dogpolicies-mcp"],
  });
});

test("config paths per client and platform", () => {
  const h = "/home/u";
  const p = (client, platform, env = {}) =>
    CLIENTS[client]
      .configPath({ platform, env, homeDir: h })
      .replaceAll("\\", "/");
  assert.equal(
    p("claude-desktop", "win32", { APPDATA: "D:/profile/AppData/Roaming" }),
    "D:/profile/AppData/Roaming/Claude/claude_desktop_config.json",
  );
  assert.equal(
    p("claude-desktop", "darwin"),
    "/home/u/Library/Application Support/Claude/claude_desktop_config.json",
  );
  assert.equal(
    p("claude-desktop", "linux"),
    "/home/u/.config/Claude/claude_desktop_config.json",
  );
  assert.equal(
    p("claude-desktop", "linux", { XDG_CONFIG_HOME: "/xdg" }),
    "/xdg/Claude/claude_desktop_config.json",
  );
  assert.equal(p("cursor", "win32"), "/home/u/.cursor/mcp.json");
  assert.equal(p("vscode", "darwin"), "/home/u/.copilot/mcp-config.json");
  assert.equal(
    p("vscode", "linux", { COPILOT_HOME: "/ch" }),
    "/ch/mcp-config.json",
  );
  assert.equal(
    p("windsurf", "linux"),
    "/home/u/.codeium/windsurf/mcp_config.json",
  );
});

for (const client of ["claude-desktop", "cursor", "vscode", "windsurf"]) {
  for (const platform of ["win32", "darwin", "linux"]) {
    test(`${client} on ${platform}: create, merge, idempotent, backup, uninstall`, () => {
      const homeDir = fresh();
      const env = envFor(homeDir);
      // 1. nothing exists: the file and the key are created
      const plan = planInstall({ client, platform, env, homeDir, now });
      assert.equal(plan.kind, "file", JSON.stringify(plan));
      assert.equal(plan.existed, false);
      assert.equal(plan.backupPath, null);
      applyPlan(plan);
      const written = JSON.parse(readFileSync(plan.path, "utf8"));
      assert.deepEqual(
        written[CLIENTS[client].key].dogpolicies,
        stdioCommand(platform),
      );
      // 2. the same again changes nothing
      const again = planInstall({ client, platform, env, homeDir, now });
      assert.equal(again.kind, "noop");
      // 3. other settings survive a merge; a backup is written
      const other = {
        preferences: { theme: "dark", nested: [1, 2] },
        [CLIENTS[client].key]: { other: { command: "x" } },
      };
      writeFileSync(plan.path, JSON.stringify(other));
      const merged = applyPlan(
        planInstall({ client, platform, env, homeDir, now }),
      );
      assert.ok(merged.backupPath && existsSync(merged.backupPath));
      assert.deepEqual(
        JSON.parse(readFileSync(merged.backupPath, "utf8")),
        other,
      );
      const after = JSON.parse(readFileSync(plan.path, "utf8"));
      assert.deepEqual(after.preferences, other.preferences);
      assert.deepEqual(after[CLIENTS[client].key].other, { command: "x" });
      assert.deepEqual(
        after[CLIENTS[client].key].dogpolicies,
        stdioCommand(platform),
      );
      // 4. uninstall removes only our entry
      applyPlan(
        planInstall({ client, platform, env, homeDir, now, uninstall: true }),
      );
      const removed = JSON.parse(readFileSync(plan.path, "utf8"));
      assert.equal(removed[CLIENTS[client].key].dogpolicies, undefined);
      assert.deepEqual(removed[CLIENTS[client].key].other, { command: "x" });
      assert.equal(
        planInstall({ client, platform, env, homeDir, now, uninstall: true })
          .kind,
        "noop",
      );
      // 5. a restart step and a log location are always given
      assert.ok(plan.restart.length > 20 && plan.logs.length > 5);
    });
  }
}

test("a config with only preferences and no mcpServers key (Wes's case) gets the key added", () => {
  const homeDir = fresh();
  const env = envFor(homeDir);
  const path = CLIENTS["claude-desktop"].configPath({
    platform: "win32",
    env,
    homeDir,
  });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify(
      { coworkUserFilesPath: "C:\\x", preferences: { a: 1 } },
      null,
      2,
    ),
  );
  const plan = applyPlan(
    planInstall({
      client: "claude-desktop",
      platform: "win32",
      env,
      homeDir,
      now,
    }),
  );
  const after = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(after.coworkUserFilesPath, "C:\\x");
  assert.deepEqual(after.preferences, { a: 1 });
  assert.deepEqual(after.mcpServers.dogpolicies, {
    command: "cmd",
    args: ["/c", "npx", "-y", "dogpolicies-mcp"],
  });
  assert.match(
    plan.backupPath,
    /claude_desktop_config\.json\.2026-11-01T12-00-00\.bak$/,
  );
  assert.match(plan.restart, /system tray/);
});

test("malformed JSON is refused, explained, and left untouched", () => {
  for (const client of ["claude-desktop", "cursor", "vscode", "windsurf"]) {
    const homeDir = fresh();
    const env = envFor(homeDir);
    const path = CLIENTS[client].configPath({
      platform: "darwin",
      env,
      homeDir,
    });
    mkdirSync(dirname(path), { recursive: true });
    const bad = '{ "mcpServers": { "x": { "command": "y", } } }';
    writeFileSync(path, bad);
    const plan = planInstall({ client, platform: "darwin", env, homeDir, now });
    assert.equal(plan.kind, "error");
    assert.match(plan.message, /not valid JSON/);
    assert.match(plan.message, /Nothing was changed/);
    assert.equal(readFileSync(path, "utf8"), bad);
    assert.equal(
      readdirSync(dirname(path)).filter((f) => f.endsWith(".bak")).length,
      0,
    );
  }
  const homeDir = fresh();
  const env = envFor(homeDir);
  const path = CLIENTS.cursor.configPath({ platform: "linux", env, homeDir });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, '{"mcpServers": []}');
  assert.match(
    planInstall({ client: "cursor", platform: "linux", env, homeDir, now })
      .message,
    /not an object/,
  );
  writeFileSync(path, "[]");
  assert.match(
    planInstall({ client: "cursor", platform: "linux", env, homeDir, now })
      .message,
    /JSON object/,
  );
  writeFileSync(path, "   ");
  assert.equal(
    planInstall({ client: "cursor", platform: "linux", env, homeDir, now })
      .kind,
    "file",
  );
});

test("--hosted writes the remote form where supported and prints steps for Claude Desktop", () => {
  const homeDir = fresh();
  const env = envFor(homeDir);
  assert.deepEqual(
    planInstall({
      client: "cursor",
      hosted: true,
      platform: "darwin",
      env,
      homeDir,
      now,
    }).entry,
    { url: HOSTED_URL },
  );
  assert.deepEqual(
    planInstall({
      client: "vscode",
      hosted: true,
      platform: "darwin",
      env,
      homeDir,
      now,
    }).entry,
    { type: "http", url: HOSTED_URL },
  );
  assert.deepEqual(
    planInstall({
      client: "windsurf",
      hosted: true,
      platform: "darwin",
      env,
      homeDir,
      now,
    }).entry,
    { serverUrl: HOSTED_URL },
  );
  const cd = planInstall({
    client: "claude-desktop",
    hosted: true,
    platform: "win32",
    env,
    homeDir,
    now,
  });
  assert.equal(cd.kind, "steps");
  assert.ok(cd.steps.some((s) => /Add custom connector/.test(s)));
  assert.ok(cd.steps.some((s) => s.includes(HOSTED_URL)));
});

test("Claude Code is a command: official claude mcp add, Windows form, hosted form, remove", () => {
  const local = planInstall({
    client: "claude-code",
    platform: "darwin",
    env: {},
    homeDir: fresh(),
  });
  assert.deepEqual(local.argv, [
    "claude",
    "mcp",
    "add",
    "--scope",
    "user",
    "dogpolicies",
    "--",
    "npx",
    "-y",
    "dogpolicies-mcp",
  ]);
  const win = planInstall({
    client: "claude-code",
    platform: "win32",
    env: {},
    homeDir: fresh(),
  });
  assert.deepEqual(
    win.argv.slice(-5),
    ["--", "cmd", "/c", "npx", "-y", "dogpolicies-mcp"].slice(-5),
  );
  const hosted = planInstall({
    client: "claude-code",
    hosted: true,
    platform: "linux",
    env: {},
    homeDir: fresh(),
  });
  assert.deepEqual(hosted.argv, [
    "claude",
    "mcp",
    "add",
    "--scope",
    "user",
    "--transport",
    "http",
    "dogpolicies",
    HOSTED_URL,
  ]);
  const rm = planInstall({
    client: "claude-code",
    uninstall: true,
    platform: "linux",
    env: {},
    homeDir: fresh(),
  });
  assert.deepEqual(rm.argv, [
    "claude",
    "mcp",
    "remove",
    "--scope",
    "user",
    "dogpolicies",
  ]);
});

test("unknown client is an error; detection finds existing client folders", () => {
  assert.equal(
    planInstall({
      client: "emacs",
      platform: "linux",
      env: {},
      homeDir: fresh(),
    }).kind,
    "error",
  );
  const homeDir = fresh();
  mkdirSync(join(homeDir, ".cursor"), { recursive: true });
  mkdirSync(join(homeDir, ".codeium", "windsurf"), { recursive: true });
  assert.deepEqual(
    detectClients({ platform: "linux", env: envFor(homeDir), homeDir }).sort(),
    ["cursor", "windsurf"],
  );
  assert.ok(CLIENT_IDS.includes("claude-desktop"));
});

test("runInstall end to end: dry run writes nothing, a real run writes, and the summary says what to do", () => {
  const homeDir = fresh();
  const env = envFor(homeDir);
  const out = [];
  const print = (s) => out.push(s);
  const code = runInstall(
    { clients: ["claude-desktop"], dryRun: true },
    { platform: "win32", env, homeDir, print },
  );
  assert.equal(code, 0);
  assert.ok(out.some((l) => /Dry run: nothing written/.test(l)));
  assert.ok(
    !existsSync(
      CLIENTS["claude-desktop"].configPath({ platform: "win32", env, homeDir }),
    ),
  );
  out.length = 0;
  const code2 = runInstall(
    { clients: ["claude-desktop", "cursor"] },
    { platform: "win32", env, homeDir, print },
  );
  assert.equal(code2, 0);
  assert.ok(
    existsSync(
      CLIENTS["claude-desktop"].configPath({ platform: "win32", env, homeDir }),
    ),
  );
  assert.ok(
    existsSync(CLIENTS.cursor.configPath({ platform: "win32", env, homeDir })),
  );
  assert.ok(
    out.some((l) => /system tray/.test(l)),
    "restart instructions printed",
  );
  assert.ok(out.some((l) => /Try it: npx dogpolicies-mcp check/.test(l)));
  // claude-code with a fake runner that fails
  out.length = 0;
  const code3 = runInstall(
    { clients: ["claude-code"] },
    {
      platform: "linux",
      env,
      homeDir,
      print,
      run: () => ({ error: new Error("ENOENT") }),
    },
  );
  assert.equal(code3, 1);
  assert.ok(
    out.some((l) =>
      /Install Claude Code or run the command above yourself/.test(l),
    ),
  );
  // default target with nothing detected is Claude Desktop
  out.length = 0;
  const code4 = runInstall(
    { clients: [] },
    { platform: "darwin", env: envFor(fresh()), homeDir: fresh(), print },
  );
  assert.equal(code4, 0);
  assert.ok(out.some((l) => /installing for Claude Desktop/.test(l)));
});
