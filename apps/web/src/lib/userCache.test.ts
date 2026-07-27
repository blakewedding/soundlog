// §6: a mutation must invalidate every query that renders the changed data.
// Changing your avatar changes bytes on surfaces you are not looking at, so
// these are the shapes the patch has to reach into.
import { describe, it, expect } from "vitest";
import { patchUserInData } from "./userCache";

const ME = "user_me";
const OTHER = "user_other";
const NEW = "/avatars/w384/user_me-ffffffffffffffff.webp";

describe("patchUserInData", () => {
  it("patches a user embedded in feed items", () => {
    const data = {
      items: [
        { id: "a1", review: { id: "r1", user: { id: ME, username: "me", avatarUrl: null } } },
        { id: "a2", review: { id: "r2", user: { id: OTHER, username: "you", avatarUrl: null } } },
      ],
    };
    const out = patchUserInData(data, ME, { avatarUrl: NEW }) as typeof data;
    expect(out.items[0].review.user.avatarUrl).toBe(NEW);
    expect(out.items[1].review.user.avatarUrl).toBeNull();
  });

  it("patches nested comment threads", () => {
    const data = {
      comments: [
        { id: "c1", user: { id: ME, username: "me", avatarUrl: null }, replies: [] },
        {
          id: "c2",
          user: { id: OTHER, username: "you", avatarUrl: null },
          replies: [{ id: "c3", user: { id: ME, username: "me", avatarUrl: null } }],
        },
      ],
    };
    const out = patchUserInData(data, ME, { avatarUrl: NEW }) as typeof data;
    expect(out.comments[0].user.avatarUrl).toBe(NEW);
    expect(out.comments[1].replies[0].user.avatarUrl).toBe(NEW);
    expect(out.comments[1].user.avatarUrl).toBeNull();
  });

  it("patches follower and similar-listener lists, which are bare user arrays", () => {
    const data = { users: [{ id: ME, username: "me", avatarUrl: null, isFollowing: true }] };
    const out = patchUserInData(data, ME, { avatarUrl: NEW }) as typeof data;
    expect(out.users[0].avatarUrl).toBe(NEW);
    // Unrelated fields on the same object survive.
    expect(out.users[0].isFollowing).toBe(true);
  });

  it("patches a top-level array", () => {
    const data = [{ id: ME, username: "me", avatarUrl: null }];
    const out = patchUserInData(data, ME, { avatarUrl: NEW }) as typeof data;
    expect(out[0].avatarUrl).toBe(NEW);
  });

  it("does NOT patch a non-user object that merely shares the id", () => {
    // A release, a review and a list all carry an `id`. Matching on id alone
    // would rewrite rows that are not people.
    const data = {
      release: { id: ME, title: "Not a person", coverUrl: "/covers/w400/x.webp" },
      review: { id: ME, content: "also not a person" },
    };
    const out = patchUserInData(data, ME, { avatarUrl: NEW });
    expect(out).toBe(data); // same reference: nothing changed
  });

  it("returns the SAME reference when the user appears nowhere", () => {
    // React Query re-renders every query whose data identity changed, so an
    // unconditional copy would re-render the whole app on any avatar change.
    const data = { items: [{ id: "a1", review: { id: "r1", user: { id: OTHER, avatarUrl: null } } }] };
    expect(patchUserInData(data, ME, { avatarUrl: NEW })).toBe(data);
  });

  it("survives the shapes that are not objects at all", () => {
    expect(patchUserInData(null, ME, { avatarUrl: NEW })).toBeNull();
    expect(patchUserInData(undefined, ME, { avatarUrl: NEW })).toBeUndefined();
    expect(patchUserInData("a string", ME, { avatarUrl: NEW })).toBe("a string");
    expect(patchUserInData(42, ME, { avatarUrl: NEW })).toBe(42);
  });

  it("patches displayName too, not only the avatar", () => {
    const data = { users: [{ id: ME, username: "me", displayName: "Old", avatarUrl: null }] };
    const out = patchUserInData(data, ME, { displayName: "New" }) as typeof data;
    expect(out.users[0].displayName).toBe("New");
  });
});
