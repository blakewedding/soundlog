import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

/**
 * The haptic vocabulary for Soundlog — the ONLY place a vibration is chosen.
 *
 * Every call site names an *intent* ("the rating moved a half step"), never a
 * mechanism ("medium impact"). Intents are the stable thing; the mapping to
 * impact styles is a taste decision that will be retuned on real hardware, and
 * keeping it in one table means retuning is one edit rather than a hunt through
 * screens.
 *
 * The policy, deliberately narrow:
 *
 *   ratingStep      selection tick   — one per half-star crossed while dragging
 *   commitLog       success notify   — a listen was logged
 *   commitReview    success notify   — a review was posted
 *   commitList      success notify   — a list edit was saved
 *   follow          light impact     — followed or unfollowed someone
 *   like            light impact     — liked or unliked a review
 *   failure         error notify     — an optimistic write rolled back
 *
 * Navigation is ABSENT on purpose. Tab switches, scrolls, opening a release —
 * none of them buzz. Haptics that fire on movement stop meaning anything, and
 * the point of this map is that a buzz always means "something was written".
 *
 * `failure` is the one addition beyond the brief's list, and it earns its place:
 * every mutation in this app is optimistic (CLAUDE.md §6), so the UI has already
 * moved by the time a write fails. A distinct error notification is the haptic
 * half of "visibly failing".
 */
export type HapticIntent =
  | "ratingStep"
  | "commitLog"
  | "commitReview"
  | "commitList"
  | "follow"
  | "like"
  | "failure";

type Play = () => Promise<void>;

/** The single mapping table. Retune here, nowhere else. */
const INTENTS: Record<HapticIntent, Play> = {
  ratingStep: () => Haptics.selectionAsync(),
  commitLog: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  commitReview: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  commitList: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  follow: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  like: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  failure: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
};

/**
 * Web has no haptics API, and Expo Go on web throws rather than no-ops. The
 * mobile package is built from the same workspace as the web client, so this
 * guard keeps a shared component from crashing if one is ever imported there.
 */
const SUPPORTED = Platform.OS === "ios" || Platform.OS === "android";

let enabled = true;

/**
 * Turn all haptics off — for a user setting, or for tests. Off is remembered
 * for the process; persistence belongs to whatever settings screen adopts it.
 */
export function setHapticsEnabled(value: boolean): void {
  enabled = value;
}

export function hapticsEnabled(): boolean {
  return enabled && SUPPORTED;
}

/**
 * Fire a haptic for an intent.
 *
 * Never throws and never rejects. A device with no taptic engine, a user who
 * disabled system haptics, or a permissions quirk must not be able to break the
 * write that triggered it — the vibration is feedback about an action, not part
 * of it. Same fault-isolation principle the backend applies to supplemental
 * upstream data (CLAUDE.md §1): a nicety may fail without failing the request.
 */
export async function haptic(intent: HapticIntent): Promise<void> {
  if (!hapticsEnabled()) return;
  try {
    await INTENTS[intent]();
  } catch {
    // Swallowed on purpose — see above.
  }
}

/**
 * Fire one selection tick per half-star actually crossed while dragging.
 *
 * A drag emits a continuous stream of values; firing on every emission would
 * produce a blur rather than the notched feel of a physical dial. Call this
 * with the previous and next rating and it fires only on a real step, so a
 * 0.5 → 3.0 sweep gives five distinct ticks and a re-render at the same value
 * gives none.
 */
export async function hapticRatingChange(
  previous: number | null,
  next: number | null
): Promise<void> {
  if (next === null || previous === next) return;
  await haptic("ratingStep");
}
