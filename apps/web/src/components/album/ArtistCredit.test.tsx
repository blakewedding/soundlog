// Phase 5.6.1 regression — artist names rendered as dead text whenever we
// couldn't tie a release to a single MusicBrainz artist. The visible case was
// the Discogs-only compilation "Total From Joy Division To New Order", credited
// "New Order, Joy Division": both artists have pages, neither was clickable.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ArtistCredit } from "./ArtistCredit";

const renderCredit = (props: Parameters<typeof ArtistCredit>[0]) =>
  render(
    <MemoryRouter>
      <ArtistCredit {...props} />
    </MemoryRouter>
  );

describe("ArtistCredit", () => {
  it("links straight to the artist page when we know the artist", () => {
    renderCredit({ artistId: "a1", artistName: "Joy Division" });
    expect(screen.getByRole("link", { name: "Joy Division" })).toHaveAttribute(
      "href",
      "/artist/a1"
    );
  });

  it("never renders dead text — an unresolved credit still links (to search)", () => {
    renderCredit({ artistId: null, artistName: "Fishmans" });
    expect(screen.getByRole("link", { name: "Fishmans" })).toHaveAttribute(
      "href",
      "/search?q=Fishmans"
    );
  });

  it("splits a multi-artist credit so EACH artist is reachable", () => {
    renderCredit({ artistId: null, artistName: "New Order, Joy Division" });

    expect(screen.getByRole("link", { name: "New Order" })).toHaveAttribute(
      "href",
      "/search?q=New%20Order"
    );
    expect(screen.getByRole("link", { name: "Joy Division" })).toHaveAttribute(
      "href",
      "/search?q=Joy%20Division"
    );
    // The credit still reads as one line.
    expect(screen.getByText(/,/)).toBeInTheDocument();
  });

  it("does not fabricate an artist id for an unresolved credit", () => {
    renderCredit({ artistId: undefined, artistName: "Some Unknown Act" });
    const link = screen.getByRole("link", { name: "Some Unknown Act" });
    // Never points at /artist/... — we don't guess identity by name (5.8).
    expect(link.getAttribute("href")).not.toMatch(/^\/artist\//);
  });
});
