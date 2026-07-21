// Phase 5.5 — the haptic map is the one place a vibration is chosen, so the
// map itself is what's worth pinning: the right feedback per intent, silence
// where the policy says silence, and never throwing into a caller's write path.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// vi.hoisted, because vi.mock factories are lifted above ordinary top-level
// declarations and would otherwise reference these before initialisation.
const { selectionAsync, notificationAsync, impactAsync } = vi.hoisted(() => ({
  selectionAsync: vi.fn(async () => {}),
  notificationAsync: vi.fn(async () => {}),
  impactAsync: vi.fn(async () => {}),
}));

vi.mock("expo-haptics", () => ({
  selectionAsync,
  notificationAsync,
  impactAsync,
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
}));

// react-native is native-only; the module reads Platform.OS to decide whether
// haptics exist at all, so a stub is enough.
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));

import { haptic, hapticRatingChange, hapticsEnabled, setHapticsEnabled } from "./haptics";

beforeEach(() => {
  setHapticsEnabled(true);
  selectionAsync.mockClear();
  notificationAsync.mockClear();
  impactAsync.mockClear();
});

afterEach(() => setHapticsEnabled(true));

describe("haptic intents", () => {
  it("ticks the selection engine for a rating step", async () => {
    await haptic("ratingStep");
    expect(selectionAsync).toHaveBeenCalledTimes(1);
    expect(impactAsync).not.toHaveBeenCalled();
    expect(notificationAsync).not.toHaveBeenCalled();
  });

  it("uses a success notification for every commit", async () => {
    for (const intent of ["commitLog", "commitReview", "commitList"] as const) {
      notificationAsync.mockClear();
      await haptic(intent);
      expect(notificationAsync).toHaveBeenCalledWith("success");
    }
  });

  it("uses a light impact for follow and like", async () => {
    await haptic("follow");
    await haptic("like");
    expect(impactAsync).toHaveBeenCalledTimes(2);
    expect(impactAsync).toHaveBeenNthCalledWith(1, "light");
    expect(impactAsync).toHaveBeenNthCalledWith(2, "light");
  });

  it("uses an error notification when an optimistic write rolls back", async () => {
    await haptic("failure");
    expect(notificationAsync).toHaveBeenCalledWith("error");
  });
});

describe("rating drag", () => {
  it("fires once per half-star actually crossed", async () => {
    // A sweep from 0.5 to 3.0 is five real steps.
    const steps = [0.5, 1, 1.5, 2, 2.5, 3];
    for (let i = 1; i < steps.length; i++) {
      await hapticRatingChange(steps[i - 1], steps[i]);
    }
    expect(selectionAsync).toHaveBeenCalledTimes(5);
  });

  it("stays silent when a re-render reports the same value", async () => {
    await hapticRatingChange(3, 3);
    expect(selectionAsync).not.toHaveBeenCalled();
  });

  it("stays silent when the rating is cleared", async () => {
    await hapticRatingChange(3, null);
    expect(selectionAsync).not.toHaveBeenCalled();
  });

  it("fires on the first rating from unrated", async () => {
    await hapticRatingChange(null, 0.5);
    expect(selectionAsync).toHaveBeenCalledTimes(1);
  });
});

describe("safety", () => {
  it("goes silent when disabled", async () => {
    setHapticsEnabled(false);
    expect(hapticsEnabled()).toBe(false);
    await haptic("commitLog");
    await hapticRatingChange(1, 1.5);
    expect(notificationAsync).not.toHaveBeenCalled();
    expect(selectionAsync).not.toHaveBeenCalled();
  });

  it("never rejects when the device refuses — feedback must not break a write", async () => {
    notificationAsync.mockRejectedValueOnce(new Error("no taptic engine"));
    await expect(haptic("commitLog")).resolves.toBeUndefined();
  });
});
