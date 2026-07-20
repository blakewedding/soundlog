import { Router } from "express";
import {
  searchCatalog,
  searchArtists,
  searchMembers,
  searchLists,
  searchLabels,
} from "../services/catalogService.js";

export const searchRouter = Router();

const TABS = ["all", "releases", "artists", "members", "lists", "labels"] as const;
type Tab = (typeof TABS)[number];

function parseTab(raw: unknown): Tab {
  const t = String(raw ?? "all");
  return (TABS as readonly string[]).includes(t) ? (t as Tab) : "all";
}

const empty = { results: [], artists: [], members: [], lists: [], labels: [] };

// GET /api/search?q=&tab=all|releases|artists|members|lists|labels&type=ALBUM|EP|...
// "all" returns a trimmed top-results view across every entity (releases fan out
// to live sources when thin). A specific tab fills only its own bucket, deeper.
// Everything but the release fan-out is Elasticsearch-backed.
searchRouter.get("/", async (req, res, next) => {
  try {
    const q = String(req.query.q ?? "").trim();
    const tab = parseTab(req.query.tab);
    const type = req.query.type as string | undefined;
    if (!q) return res.json({ tab, ...empty });

    switch (tab) {
      case "releases":
        return res.json({ tab, ...empty, results: await searchCatalog(q, type) });
      case "artists":
        return res.json({ tab, ...empty, artists: await searchArtists(q, 25) });
      case "members":
        return res.json({ tab, ...empty, members: await searchMembers(q, 25) });
      case "lists":
        return res.json({ tab, ...empty, lists: await searchLists(q, 25) });
      case "labels":
        return res.json({ tab, ...empty, labels: await searchLabels(q, 25) });
      case "all":
      default: {
        const [results, artists, members, lists, labels] = await Promise.all([
          searchCatalog(q, type),
          searchArtists(q, 5),
          searchMembers(q, 5),
          searchLists(q, 5),
          searchLabels(q, 5),
        ]);
        return res.json({ tab: "all", results, artists, members, lists, labels });
      }
    }
  } catch (err) {
    next(err);
  }
});
