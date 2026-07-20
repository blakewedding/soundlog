import type { FeedItem, Paginated } from "@soundlog/shared";

// On a device/simulator, localhost is the device itself — set EXPO_PUBLIC_API_URL
// to the dev machine's LAN IP (e.g. http://192.168.1.20:4000) to reach the API.
const API = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000";

// Mobile auth (expo-auth-session) is a later deliverable; until then a dev token
// can be supplied via env so the feed can be exercised against a real account.
const DEV_TOKEN = process.env.EXPO_PUBLIC_DEV_TOKEN;

export class UnauthenticatedError extends Error {}

export async function getFeed(cursor?: string): Promise<Paginated<FeedItem>> {
  const url = `${API}/api/feed?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
  const res = await fetch(url, {
    headers: DEV_TOKEN ? { Authorization: `Bearer ${DEV_TOKEN}` } : {},
  });
  if (res.status === 401) throw new UnauthenticatedError("Sign in to see your feed");
  if (!res.ok) throw new Error(`Feed request failed (${res.status})`);
  return (await res.json()) as Paginated<FeedItem>;
}
