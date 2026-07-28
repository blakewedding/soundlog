// The avatar control. §6 is the whole test list: the tile moves on click, a
// failure rolls back AND says so, and every surface showing this user agrees
// afterwards.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AvatarField } from "./AvatarField";
import { api, ApiError, type OwnProfile } from "../../services/api";

const refreshUser = vi.fn();
vi.mock("../../contexts/AuthContext", () => ({
  useAuth: () => ({ refreshUser }),
}));

const BASE: OwnProfile = {
  id: "u1",
  username: "blake",
  email: "b@example.com",
  displayName: null,
  bio: null,
  avatarUrl: null,
  links: [],
  plan: "FREE",
  profileVisibility: "PUBLIC",
  createdAt: new Date().toISOString(),
  emailVerified: true,
};

function renderField(profile: Partial<OwnProfile> = {}) {
  const onChange = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <AvatarField profile={{ ...BASE, ...profile }} onChange={onChange} />
    </QueryClientProvider>
  );
  return { onChange };
}

const jpeg = () => new File([new Uint8Array([0xff, 0xd8, 0xff, 0x00])], "a.jpg", { type: "image/jpeg" });

beforeEach(() => {
  vi.restoreAllMocks();
  refreshUser.mockReset();
  // jsdom has no object-URL implementation.
  globalThis.URL.createObjectURL = vi.fn(() => "blob:preview");
  globalThis.URL.revokeObjectURL = vi.fn();
});

describe("AvatarField", () => {
  it("narrows the accept list to what the backend takes, not image/*", async () => {
    // Load-bearing on iOS: a wide accept hands over HEIC, which the gauntlet
    // refuses. This attribute is what makes Safari transcode to JPEG.
    renderField();
    const input = document.querySelector<HTMLInputElement>("#avatar-file")!;
    expect(input.accept).toBe("image/jpeg,image/png,image/webp");
    // `capture` would force the camera and remove the photo library.
    expect(input.hasAttribute("capture")).toBe(false);
  });

  it("shows the picked file immediately, before the upload resolves", async () => {
    // §6.1: the UI moves on click. The server round trip includes an image
    // encode, which is far too long to show nothing.
    let resolve!: (v: { profile: OwnProfile; bytes: number }) => void;
    vi.spyOn(api, "uploadAvatar").mockReturnValue(new Promise((r) => { resolve = r; }));
    renderField();

    await userEvent.upload(document.querySelector<HTMLInputElement>("#avatar-file")!, jpeg());

    await waitFor(() => {
      expect(screen.getByRole("img", { name: /profile picture/i })).toHaveAttribute("src", "blob:preview");
    });
    resolve({ profile: { ...BASE, avatarUrl: "/avatars/w384/u1-abc.webp" }, bytes: 1 });
  });

  it("swaps the local preview for the served rendition once it lands", async () => {
    // The two images DIFFER — the stored master is centre-cropped square.
    // Leaving the preview up shows the uploader something nobody else sees.
    vi.spyOn(api, "uploadAvatar").mockResolvedValue({
      profile: { ...BASE, avatarUrl: "/avatars/w384/u1-abc.webp" },
      bytes: 1,
    });
    const { onChange } = renderField();

    await userEvent.upload(document.querySelector<HTMLInputElement>("#avatar-file")!, jpeg());

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
  });

  it("rolls back AND says so when the upload fails", async () => {
    // A bare await with no catch is forbidden: the click would silently do
    // nothing and the picture would appear to have uploaded.
    vi.spyOn(api, "uploadAvatar").mockRejectedValue(new ApiError(400, "That image is 6.1 MB. The limit is 5 MB."));
    renderField();

    await userEvent.upload(document.querySelector<HTMLInputElement>("#avatar-file")!, jpeg());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/limit is 5 MB/);
    // Rolled back to the person glyph rather than stranding the preview.
    expect(screen.queryByRole("img", { name: /profile picture/i })).toBeNull();
  });

  it("clears the input after a failure so the same file can be retried", async () => {
    // Re-picking an identical file fires no change event if the input still
    // holds it, and the retry appears to do nothing.
    vi.spyOn(api, "uploadAvatar").mockRejectedValue(new ApiError(400, "nope"));
    renderField();

    const input = document.querySelector<HTMLInputElement>("#avatar-file")!;
    await userEvent.upload(input, jpeg());
    await screen.findByRole("alert");
    expect(input.value).toBe("");
  });

  it("refuses HEIC in the browser, naming it, without a round trip", async () => {
    // The most likely rejection on a real phone. Answering locally saves a
    // multi-megabyte upload for a definite failure.
    //
    // fireEvent, NOT userEvent.upload: userEvent honours the `accept`
    // attribute and drops a non-matching file silently, which would make this
    // test pass for the wrong reason. A real picker can still hand over HEIC —
    // that is the entire premise of the guard — so the event has to be
    // delivered directly.
    const upload = vi.spyOn(api, "uploadAvatar");
    renderField();

    const input = document.querySelector<HTMLInputElement>("#avatar-file")!;
    const heic = new File([new Uint8Array([0])], "IMG_1.HEIC", { type: "image/heic" });
    Object.defineProperty(input, "files", { value: [heic], configurable: true });
    fireEvent.change(input);

    expect(await screen.findByRole("alert")).toHaveTextContent(/HEIC/);
    expect(upload).not.toHaveBeenCalled();
  });

  it("offers Remove only when there is something to remove", async () => {
    renderField();
    expect(screen.queryByRole("button", { name: /remove/i })).toBeNull();
  });

  it("removes the picture and reports failure visibly", async () => {
    vi.spyOn(api, "deleteAvatar").mockRejectedValue(new ApiError(500, "boom"));
    renderField({ avatarUrl: "/avatars/w384/u1-abc.webp" });

    await userEvent.click(screen.getByRole("button", { name: /remove/i }));
    // The SERVER's message wins when there is one — the generic fallback is
    // only for a failure that carried no message at all (a dropped connection).
    expect(await screen.findByRole("alert")).toHaveTextContent(/boom/);
  });
});
