// Reserved usernames. The hazard is not a name collision — it is that
// `/:username` is a catch-all routed behind every static route, so an account
// named after one has a profile nobody can open, including its owner.
import { describe, it, expect } from "vitest";
import { RESERVED_USERNAMES, isReservedUsername } from "../../src/config/reservedUsernames.js";

describe("isReservedUsername", () => {
  it("catches the eight segments that were already exposed", () => {
    // These were registerable before 6.2b. None had been taken on production,
    // so this closed a latent hole rather than repairing a live one.
    for (const name of [
      "diary",
      "explore",
      "forgot-password",
      "lists",
      "login",
      "reset-password",
      "search",
      "verify-email",
    ]) {
      expect(isReservedUsername(name), name).toBe(true);
    }
  });

  it("catches settings, the one that prompted the check", () => {
    expect(isReservedUsername("settings")).toBe(true);
  });

  it("is case-insensitive — usernames are compared lowercased", () => {
    expect(isReservedUsername("Settings")).toBe(true);
    expect(isReservedUsername("ADMIN")).toBe(true);
    expect(isReservedUsername("SeArCh")).toBe(true);
  });

  it("ignores surrounding whitespace", () => {
    expect(isReservedUsername("  admin  ")).toBe(true);
  });

  it("refuses names that should never be a person", () => {
    // Not a routing problem: an account called `support` messaging users is a
    // phishing primitive that costs nothing to prevent.
    for (const name of ["admin", "support", "official", "soundlog", "security", "staff"]) {
      expect(isReservedUsername(name), name).toBe(true);
    }
  });

  it("leaves ordinary names alone", () => {
    for (const name of ["blake", "sasha", "big_sigh", "searching", "settings_", "diary2", "admin_"]) {
      expect(isReservedUsername(name), name).toBe(false);
    }
  });

  it("has no duplicates", () => {
    expect(new Set(RESERVED_USERNAMES).size).toBe(RESERVED_USERNAMES.length);
  });

  it("is entirely lowercase, or the case-insensitive lookup silently misses", () => {
    // The set is built from these literals verbatim and probed with a
    // lowercased input, so an uppercase entry here would never match anything.
    for (const name of RESERVED_USERNAMES) {
      expect(name, name).toBe(name.toLowerCase());
    }
  });
});
