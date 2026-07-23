// The dev credential holder exists so a real device can reach the authenticated
// feed before Phase 7 builds mobile auth. The contract that matters most is the
// negative one: in a release build it must do NOTHING — no read, no write, no
// token — regardless of what a screen asks it to do.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { getItemAsync, setItemAsync, deleteItemAsync } = vi.hoisted(() => ({
  getItemAsync: vi.fn(async () => null as string | null),
  setItemAsync: vi.fn(async () => {}),
  deleteItemAsync: vi.fn(async () => {}),
}));

vi.mock("expo-secure-store", () => ({ getItemAsync, setItemAsync, deleteItemAsync }));

/** Re-import with a given __DEV__ and environment, since both are read at load. */
async function loadModule(isDev: boolean, envToken?: string) {
  vi.resetModules();
  vi.stubGlobal("__DEV__", isDev);
  vi.stubGlobal("process", { env: envToken ? { EXPO_PUBLIC_DEV_TOKEN: envToken } : {} });
  return import("./devAuth.js");
}

beforeEach(() => {
  getItemAsync.mockReset().mockResolvedValue(null);
  setItemAsync.mockReset().mockResolvedValue(undefined);
  deleteItemAsync.mockReset().mockResolvedValue(undefined);
});

afterEach(() => vi.unstubAllGlobals());

describe("production build", () => {
  it("never returns a token, even with one in the environment", async () => {
    const m = await loadModule(false, "env-token-should-be-ignored");
    expect(m.getDevToken()).toBeNull();
    expect(await m.loadDevToken()).toBeNull();
    expect(m.devTokenSource()).toBe("none");
  });

  it("never reads secure storage", async () => {
    const m = await loadModule(false);
    await m.loadDevToken();
    expect(getItemAsync).not.toHaveBeenCalled();
  });

  it("never writes a token, even if a screen tries", async () => {
    const m = await loadModule(false);
    await m.setDevToken("smuggled");
    expect(setItemAsync).not.toHaveBeenCalled();
    expect(m.getDevToken()).toBeNull();
  });
});

describe("development build", () => {
  it("falls back to EXPO_PUBLIC_DEV_TOKEN when nothing is stored", async () => {
    const m = await loadModule(true, "env-token");
    await m.loadDevToken();
    expect(m.getDevToken()).toBe("env-token");
    expect(m.devTokenSource()).toBe("env");
  });

  it("prefers a device-stored token over the build-time one", async () => {
    // This is the whole point: a token entered on the device outlives the
    // Metro restart that drops a bundle-inlined EXPO_PUBLIC_DEV_TOKEN.
    getItemAsync.mockResolvedValue("stored-token");
    const m = await loadModule(true, "env-token");
    await m.loadDevToken();
    expect(m.getDevToken()).toBe("stored-token");
    expect(m.devTokenSource()).toBe("device");
  });

  it("persists a token on sign-in", async () => {
    const m = await loadModule(true);
    await m.setDevToken("fresh");
    expect(setItemAsync).toHaveBeenCalledWith("soundlog.dev.accessToken", "fresh");
    expect(m.getDevToken()).toBe("fresh");
  });

  it("clears the stored token on sign-out", async () => {
    const m = await loadModule(true);
    await m.setDevToken("fresh");
    await m.setDevToken(null);
    expect(deleteItemAsync).toHaveBeenCalledWith("soundlog.dev.accessToken");
    expect(m.getDevToken()).toBeNull();
  });

  it("reports no token when there is neither a stored nor an env one", async () => {
    const m = await loadModule(true);
    await m.loadDevToken();
    expect(m.getDevToken()).toBeNull();
    expect(m.devTokenSource()).toBe("none");
  });

  it("survives a secure-store failure rather than breaking the app", async () => {
    // Simulator keychains misbehave; a credential helper must never crash boot.
    getItemAsync.mockRejectedValue(new Error("keychain unavailable"));
    const m = await loadModule(true, "env-token");
    await expect(m.loadDevToken()).resolves.toBe("env-token");
  });

  it("reads secure storage only once", async () => {
    const m = await loadModule(true);
    await m.loadDevToken();
    await m.loadDevToken();
    expect(getItemAsync).toHaveBeenCalledTimes(1);
  });
});
