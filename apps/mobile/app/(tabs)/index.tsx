import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import type { FeedItem } from "@soundlog/shared";
import { getFeed, UnauthenticatedError } from "../../src/api";

export default function Feed() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const page = await getFeed();
      setItems(page.items);
      setError(null);
    } catch (err) {
      setError(err instanceof UnauthenticatedError ? err.message : "Couldn't load your feed.");
    }
  }, []);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  // Pull-to-refresh.
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#c8a24b" />
      </View>
    );
  }

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={items.length === 0 ? styles.center : styles.list}
      data={items}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <FeedRow item={item} />}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#c8a24b" />
      }
      ListEmptyComponent={
        <Text style={styles.empty}>
          {error ?? "Your feed is quiet — follow some members on the web to fill it."}
        </Text>
      }
    />
  );
}

function actorName(item: FeedItem) {
  return item.user.displayName ?? item.user.username;
}

function describe(item: FeedItem): string {
  switch (item.type) {
    case "LOG":
      return `logged a listen to ${item.release?.title ?? "a release"}`;
    case "RATING":
      return `rated ${item.release?.title ?? "a release"}${item.rating != null ? ` ${item.rating}★` : ""}`;
    case "REVIEW":
      return `reviewed ${item.review?.release.title ?? "a release"}`;
    case "LIST_CREATE":
      return `created the list ${item.list?.title ?? ""}`;
    case "LIST_ITEM_ADD":
      return `added to ${item.list?.title ?? "a list"}`;
    case "COMMENT":
      return "commented on a review";
    case "FOLLOW":
      return `followed ${item.targetUser?.displayName ?? item.targetUser?.username ?? "someone"}`;
    default:
      return "did something";
  }
}

function FeedRow({ item }: { item: FeedItem }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowText}>
        <Text style={styles.actor}>{actorName(item)}</Text> <Text style={styles.dim}>{describe(item)}</Text>
      </Text>
      {item.type === "REVIEW" && item.review && !item.review.containsSpoilers && (
        <Text style={styles.body} numberOfLines={3}>
          {item.review.content}
        </Text>
      )}
      <Text style={styles.date}>{new Date(item.createdAt).toLocaleDateString()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0a0a0c" },
  list: { padding: 12 },
  center: { flexGrow: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  empty: { color: "#9c978b", textAlign: "center" },
  row: {
    backgroundColor: "#131316",
    borderColor: "#2a2a30",
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
    gap: 6,
  },
  rowText: { color: "#edeae2", fontSize: 15 },
  actor: { fontWeight: "600", color: "#edeae2" },
  dim: { color: "#9c978b" },
  body: { color: "#edeae2", fontSize: 14 },
  date: { color: "#6b675e", fontSize: 12, fontFamily: "monospace" },
});
