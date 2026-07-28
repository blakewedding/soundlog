// The profile fields form. The point of it being its OWN form — rather than
// part of a page-wide Save — is that its success and its failure are both
// locatable, so those are what these test.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProfileForm } from "./ProfileForm";
import { api, ApiError, type OwnProfile } from "../../services/api";

const refreshUser = vi.fn();
vi.mock("../../contexts/AuthContext", () => ({ useAuth: () => ({ refreshUser }) }));

const BASE: OwnProfile = {
  id: "u1",
  username: "blake",
  email: "b@example.com",
  displayName: null,
  bio: null,
  avatarUrl: null,
  links: [],
  pendingEmail: null,
  plan: "FREE",
  profileVisibility: "PUBLIC",
  hasPassword: true,
  createdAt: new Date().toISOString(),
  emailVerified: true,
};

function renderForm(profile: Partial<OwnProfile> = {}) {
  const onChange = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ProfileForm profile={{ ...BASE, ...profile }} onChange={onChange} />
    </QueryClientProvider>
  );
  return { onChange };
}

beforeEach(() => {
  vi.restoreAllMocks();
  refreshUser.mockReset();
});

describe("ProfileForm", () => {
  it("sends null rather than an empty string when a field is cleared", async () => {
    // "" and null are different rows. The API treats null as "unset", and
    // storing "" would make displayName render as an empty heading.
    const spy = vi.spyOn(api, "updateMyProfile").mockResolvedValue({ profile: BASE });
    renderForm({ displayName: "Blake" });

    await userEvent.clear(screen.getByLabelText(/display name/i));
    await userEvent.click(screen.getByRole("button", { name: /save profile/i }));

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ displayName: null }));
  });

  it("confirms success, because nothing on the form visibly changes", async () => {
    // Without this, a save that worked and a save that was silently dropped
    // look identical.
    vi.spyOn(api, "updateMyProfile").mockResolvedValue({
      profile: { ...BASE, displayName: "Blake W" },
    });
    renderForm();

    await userEvent.type(screen.getByLabelText(/display name/i), "Blake W");
    await userEvent.click(screen.getByRole("button", { name: /save profile/i }));

    expect(await screen.findByRole("status")).toHaveTextContent(/saved/i);
  });

  it("translates a 422 from the links schema into something a person can act on", async () => {
    vi.spyOn(api, "updateMyProfile").mockRejectedValue(new ApiError(422, "Validation failed"));
    renderForm();

    await userEvent.click(screen.getByRole("button", { name: /save profile/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/https:\/\//);
    // Not the raw server phrase, which says nothing about which field.
    expect(alert).not.toHaveTextContent(/Validation failed/);
  });

  it("keeps what the user typed after a rejected save", async () => {
    // The retry affordance. Clearing the form on failure would make them type
    // it all again to find out what was wrong.
    vi.spyOn(api, "updateMyProfile").mockRejectedValue(new ApiError(422, "nope"));
    renderForm();

    await userEvent.type(screen.getByLabelText(/display name/i), "Blake W");
    await userEvent.click(screen.getByRole("button", { name: /save profile/i }));
    await screen.findByRole("alert");

    expect(screen.getByLabelText(/display name/i)).toHaveValue("Blake W");
  });

  it("drops blank link rows instead of collecting a 422 for them", async () => {
    // Adding a row and not filling it in is the normal way to change your mind.
    const spy = vi.spyOn(api, "updateMyProfile").mockResolvedValue({ profile: BASE });
    renderForm();

    await userEvent.click(screen.getByRole("button", { name: /add a link/i }));
    await userEvent.click(screen.getByRole("button", { name: /save profile/i }));

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ links: [] }));
  });

  it("stops offering more links at the cap the server enforces", async () => {
    renderForm({
      links: Array.from({ length: 5 }, (_, i) => ({ label: `L${i}`, url: "https://example.com" })),
    });
    expect(screen.queryByRole("button", { name: /add a link/i })).toBeNull();
  });

  it("gives each remove button its own accessible name", async () => {
    // §8: two controls on one page must not share one. Five identical "Remove"
    // buttons is five identical names in a row.
    renderForm({
      links: [
        { label: "Bandcamp", url: "https://a.example" },
        { label: "Site", url: "https://b.example" },
      ],
    });
    expect(screen.getByRole("button", { name: /remove link 1, Bandcamp/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove link 2, Site/i })).toBeInTheDocument();
  });
});
