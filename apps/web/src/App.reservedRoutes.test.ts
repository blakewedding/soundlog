// Every static route segment must be a reserved username.
//
// `/:username` is routed LAST as a catch-all so static routes win the match.
// The consequence is that any static segment is a name whose owner would have a
// permanently unreachable profile — registering `search` does not fail and does
// not warn, it quietly creates an account nobody can visit, including its owner,
// and the only remedy afterwards is renaming a live user.
//
// This test is the guard, and it lives HERE rather than in the backend on
// purpose: the thing that changes is App.tsx, so the failure should land in the
// package where the route was added, not two directories away.
//
// It reads both files from disk rather than importing them. The reserved list
// is enforced server-side and therefore lives in the backend, which
// `@soundlog/shared` cannot bridge (CLAUDE.md: shared is not a backend
// dependency). A regex over the source is cruder than an import and is the only
// thing that spans the boundary without inventing a dependency to satisfy a
// test.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");
const APP = path.join(ROOT, "apps/web/src/App.tsx");
const RESERVED = path.join(ROOT, "backend/src/config/reservedUsernames.ts");

/** Static first segments from `<Route path="/foo" …>`, ignoring `/:param`. */
function staticRouteSegments(): string[] {
  const src = readFileSync(APP, "utf8");
  const out = new Set<string>();
  for (const m of src.matchAll(/<Route\s+path="\/([^"]*)"/g)) {
    const first = m[1].split("/")[0];
    // "" is the index route; ":x" is the catch-all we are protecting.
    if (first && !first.startsWith(":")) out.add(first.toLowerCase());
  }
  return [...out].sort();
}

function reservedNames(): Set<string> {
  const src = readFileSync(RESERVED, "utf8");
  const body = src.slice(src.indexOf("RESERVED_USERNAMES"));
  return new Set([...body.matchAll(/"([a-z0-9_-]+)"/g)].map((m) => m[1]));
}

describe("reserved usernames vs. the router", () => {
  it("finds the routes it is meant to be checking", () => {
    // Guards the regex itself: if App.tsx is restructured and this stops
    // matching, the test would otherwise pass vacuously and protect nothing.
    const segments = staticRouteSegments();
    expect(segments.length).toBeGreaterThan(8);
    expect(segments).toContain("settings");
    expect(segments).toContain("login");
  });

  it("reserves every static route segment", () => {
    const reserved = reservedNames();
    const unreserved = staticRouteSegments().filter((s) => !reserved.has(s));
    expect(
      unreserved,
      `These route segments are registerable as usernames, which would make those accounts unreachable. ` +
        `Add them to backend/src/config/reservedUsernames.ts: ${unreserved.join(", ")}`
    ).toEqual([]);
  });
});
