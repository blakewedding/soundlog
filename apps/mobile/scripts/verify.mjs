#!/usr/bin/env node
/**
 * Mobile verification: typecheck, tests, and — the part that matters here — a
 * REAL Metro bundle.
 *
 *   pnpm --filter @soundlog/mobile verify
 *
 * Why the bundle step exists. Typecheck and unit tests can both pass while the
 * app is unrunnable:
 *
 *   - `tsc` resolves types, and in a pnpm workspace it will happily find a
 *     package hoisted into the virtual store even when the app's own
 *     node_modules has no link to it.
 *   - Vitest mocks native modules (`vi.mock("expo-secure-store")`), so a test
 *     suite proves the *logic* and says nothing about whether the module can
 *     actually be resolved on a device.
 *
 * Only bundling exercises Metro's real resolver over the real dependency graph,
 * which is what the phone does. It is the cheapest check that answers "will
 * this actually run".
 *
 * It also checks for a STALE BUNDLER, which is a different failure with an
 * identical symptom — see checkBundlerFreshness below.
 */

import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, "..");

let failed = false;

function step(name, fn) {
  process.stdout.write(`▸ ${name}\n`);
  try {
    fn();
    process.stdout.write(`  ✓ ${name}\n`);
  } catch (err) {
    failed = true;
    process.stdout.write(`  ✗ ${name}\n`);
    if (err?.stdout) process.stdout.write(String(err.stdout));
    if (err?.stderr) process.stdout.write(String(err.stderr));
  }
}

const run = (cmd, args) =>
  execFileSync(cmd, args, { cwd: APP, stdio: ["ignore", "pipe", "pipe"] });

step("typecheck", () => run("./node_modules/.bin/tsc", ["-p", "tsconfig.json", "--noEmit"]));
step("tests", () => run("./node_modules/.bin/vitest", ["run"]));

step("bundle (Metro resolves every import for real)", () => {
  const out = mkdtempSync(join(tmpdir(), "soundlog-verify-"));
  try {
    run("npx", ["expo", "export", "--platform", "ios", "--output-dir", out]);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

/**
 * A running Metro caches its module map at startup. Install a package after it
 * started and the device keeps failing with "Unable to resolve module <x>" —
 * even though package.json, the lockfile, node_modules and a fresh bundle are
 * all perfectly correct. The repository is right and the device is wrong, which
 * makes it look like a code bug and sends you hunting through the diff.
 *
 * No repo-level check can catch this, because nothing in the repo is broken.
 * So compare the bundler's start time against the last dependency change.
 */
function checkBundlerFreshness() {
  let pid;
  try {
    pid = execSync("lsof -nP -iTCP:8081 -sTCP:LISTEN -t", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim()
      .split("\n")[0];
  } catch {
    return; // no bundler running — nothing to be stale
  }
  if (!pid) return;

  let startedAt;
  try {
    startedAt = new Date(
      execSync(`ps -p ${pid} -o lstart=`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim()
    );
  } catch {
    return;
  }

  const marker = join(APP, "node_modules", ".modules.yaml");
  const depsPath = existsSync(marker) ? marker : join(APP, "package.json");
  const depsChangedAt = statSync(depsPath).mtime;

  if (depsChangedAt > startedAt) {
    failed = true;
    process.stdout.write(
      `  ✗ stale bundler\n` +
        `    Metro (pid ${pid}) started ${startedAt.toLocaleTimeString()}, but dependencies\n` +
        `    changed at ${depsChangedAt.toLocaleTimeString()}. It is serving a module map from\n` +
        `    before that change, so the device will fail to resolve newly added packages.\n` +
        `    Restart it:  pnpm --filter @soundlog/mobile dev --clear\n`
    );
  } else {
    process.stdout.write(`  ✓ bundler is newer than the last dependency change\n`);
  }
}

process.stdout.write(`▸ bundler freshness\n`);
checkBundlerFreshness();

process.exit(failed ? 1 : 0);
