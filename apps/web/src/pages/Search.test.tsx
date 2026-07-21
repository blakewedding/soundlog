// Phase 5: the tabbed search UI. Switching tabs re-queries the API with the
// selected tab, and each entity kind renders its own row/card with a link to the
// right destination (member → profile, label → label page, list → list page).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SearchResponse, SearchTab } from "@soundlog/shared";
import Search from "./Search";
import { api } from "../services/api";

vi.mock("../services/api", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../services/api")>();
  return { ...mod, api: { ...mod.api, search: vi.fn() } };
});

const empty = { results: [], artists: [], members: [], lists: [], labels: [] };

function response(tab: SearchTab, over: Partial<SearchResponse>): SearchResponse {
  return { tab, ...empty, ...over };
}

beforeEach(() => {
  vi.mocked(api.search).mockImplementation(async (_q: string, tab: SearchTab = "all") => {
    if (tab === "members")
      return response("members", { members: [{ id: "u1", username: "sasha", displayName: "Sasha" }] });
    if (tab === "labels")
      return response("labels", { labels: [{ id: "l1", name: "Creation Records", area: "UK", releaseCount: 3 }] });
    // "all": a bit of everything
    return response("all", {
      members: [{ id: "u1", username: "sasha", displayName: "Sasha" }],
      labels: [{ id: "l1", name: "Creation Records", area: "UK", releaseCount: 3 }],
    });
  });
});

function renderSearch() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Search />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("Search — tabbed", () => {
  it("queries the Members tab and links a member to their profile", async () => {
    renderSearch();
    await userEvent.type(screen.getByLabelText(/search soundlog/i), "sasha");
    // Default "all" tab surfaces the member.
    const member = await screen.findByText("Sasha");
    expect(member.closest("a")).toHaveAttribute("href", "/sasha");

    // Switch to Members tab → the API is called with tab="members".
    await userEvent.click(screen.getByRole("tab", { name: "Members" }));
    await waitFor(() => expect(api.search).toHaveBeenCalledWith("sasha", "members"));
  });

  it("renders a label result linking to its label page", async () => {
    renderSearch();
    await userEvent.type(screen.getByLabelText(/search soundlog/i), "creation");
    await userEvent.click(screen.getByRole("tab", { name: "Labels" }));

    const label = await screen.findByText("Creation Records");
    expect(label.closest("a")).toHaveAttribute("href", "/label/l1");
    expect(within(label.closest("a")!).getByText(/3 releases/i)).toBeInTheDocument();
  });

  // Phase 5.5 — role="tab" promises these keys. They previously did nothing.
  describe("keyboard (ARIA tablist)", () => {
    it("is a single tab stop, with only the selected tab reachable", () => {
      renderSearch();
      const tabs = screen.getAllByRole("tab");
      expect(tabs[0]).toHaveAttribute("tabindex", "0"); // "All" is selected
      for (const t of tabs.slice(1)) expect(t).toHaveAttribute("tabindex", "-1");
    });

    it("moves selection with Left/Right and wraps at both ends", async () => {
      const user = userEvent.setup();
      renderSearch();
      const tabs = screen.getAllByRole("tab");
      tabs[0].focus();

      await user.keyboard("{ArrowRight}");
      expect(screen.getByRole("tab", { name: "Releases" })).toHaveFocus();
      expect(screen.getByRole("tab", { name: "Releases" })).toHaveAttribute("aria-selected", "true");

      // Left from the first tab wraps to the last.
      screen.getByRole("tab", { name: "All" }).focus();
      await user.click(screen.getByRole("tab", { name: "All" }));
      await user.keyboard("{ArrowLeft}");
      expect(screen.getByRole("tab", { name: "Labels" })).toHaveFocus();
    });

    it("jumps to the ends with Home and End", async () => {
      const user = userEvent.setup();
      renderSearch();
      screen.getByRole("tab", { name: "All" }).focus();

      await user.keyboard("{End}");
      expect(screen.getByRole("tab", { name: "Labels" })).toHaveFocus();
      await user.keyboard("{Home}");
      expect(screen.getByRole("tab", { name: "All" })).toHaveFocus();
    });

    it("points every tab at the results panel it controls", () => {
      renderSearch();
      const panel = screen.getByRole("tabpanel");
      expect(panel).toHaveAttribute("id", "search-results");
      for (const t of screen.getAllByRole("tab")) {
        expect(t).toHaveAttribute("aria-controls", "search-results");
      }
      expect(panel).toHaveAttribute("aria-labelledby", "search-tab-all");
    });
  });
});
