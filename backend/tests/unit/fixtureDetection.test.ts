// The fixture purge deletes rows, so its detection has to be exactly right in
// both directions: it must catch every synthetic shape the suites produce, and
// it must never match real catalogue data. A false positive here silently
// deletes someone's records.
import { describe, it, expect } from "vitest";
import { isFixtureArtist, isFixtureRelease } from "../../scripts/lib/fixtures.js";

const release = (over: Partial<Parameters<typeof isFixtureRelease>[0]> = {}) => ({
  title: "Dummy",
  artistName: "Portishead",
  musicbrainzId: "ea92a194-2d60-35c7-9d56-0e1dba20cd45",
  coverUrl: "https://coverartarchive.org/release/x/front-500.jpg",
  ...over,
});

describe("catches test debris", () => {
  it("flags the non-UUID MusicBrainz ids every suite generates", () => {
    for (const mbid of [
      "disco-rg-mrwiup8e-7",
      "disco-artist-mrwiup8e",
      "seedres-abc123",
      "caahttp-abc123",
      "caa-fail-abc123",
      "mb-rel-abc123",
      "zorbtron123",
    ]) {
      expect(isFixtureRelease(release({ musicbrainzId: mbid }))).toBe(true);
    }
  });

  it("flags the generated title+artist pair even without an mbid", () => {
    expect(
      isFixtureRelease(
        release({ title: "Record 7", artistName: "Prolific mrwiup8e", musicbrainzId: null })
      )
    ).toBe(true);
  });

  it("flags fixture cover hosts", () => {
    expect(isFixtureRelease(release({ coverUrl: "https://caa.example/7.jpg" }))).toBe(true);
    expect(isFixtureRelease(release({ coverUrl: "http://cdn.example.test/a.jpg" }))).toBe(true);
  });

  it("flags synthetic artists", () => {
    expect(isFixtureArtist({ name: "Prolific mrwiup8e", musicbrainzId: null })).toBe(true);
    expect(isFixtureArtist({ name: "Anything", musicbrainzId: "disco-artist-x1" })).toBe(true);
  });
});

describe("never touches real data", () => {
  it("leaves a normal seeded release alone", () => {
    expect(isFixtureRelease(release())).toBe(false);
  });

  it("leaves Discogs-seeded releases with no MusicBrainz id alone", () => {
    // Five real rows in the dev catalogue look exactly like this.
    expect(
      isFixtureRelease(
        release({ title: "Small Change", artistName: "Tom Waits", musicbrainzId: null })
      )
    ).toBe(false);
  });

  it("does not match real titles that merely start with 'Record'", () => {
    expect(
      isFixtureRelease(release({ title: "Record Collection", artistName: "Mark Ronson" }))
    ).toBe(false);
  });

  it("does not match a real artist whose name starts with 'Prolific'", () => {
    expect(isFixtureArtist({ name: "Prolific", musicbrainzId: null })).toBe(false);
    expect(isFixtureArtist({ name: "Prolific Demise", musicbrainzId: null })).toBe(false);
  });

  it("does not match example.com-ish hosts that are actually real", () => {
    // The pattern requires a `.example` LABEL, not the substring "example".
    expect(isFixtureRelease(release({ coverUrl: "https://examples.fm/a.jpg" }))).toBe(false);
    expect(isFixtureRelease(release({ coverUrl: "https://i.discogs.com/example/a.jpg" }))).toBe(
      false
    );
  });

  it("accepts uppercase UUIDs as real", () => {
    expect(
      isFixtureRelease(release({ musicbrainzId: "EA92A194-2D60-35C7-9D56-0E1DBA20CD45" }))
    ).toBe(false);
  });
});
