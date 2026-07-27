// The Avatar component. Mostly about the two things §8 cares about: it never
// hand-builds a URL, and it does not put a redundant accessible name next to
// the person's name as text.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Avatar } from "./Avatar";

const STORED = "/avatars/w384/clx7k2p9q0000abcd1234efgh-a3f19c4e7b2d8016.webp";

describe("Avatar", () => {
  it("asks for the rendition its surface actually paints", () => {
    const { container } = render(<Avatar src={STORED} name="Blake" size="row" decorative={false} />);
    const img = container.querySelector("img")!;
    // Not the stored 384 — the row surface paints ~28px, so it takes the 48.
    expect(img.getAttribute("src")).toContain("/avatars/w48/");
    expect(img.getAttribute("srcset")).toContain("/avatars/w96/");
  });

  it("falls back to a person glyph rather than a broken image", () => {
    const { container } = render(<Avatar src={null} name="Blake" />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("is silent for assistive tech when it sits beside the name as text", () => {
    // The default. Hearing "Blake, Blake" on every comment row is noise.
    render(<Avatar src={STORED} name="Blake" />);
    expect(screen.queryByRole("img", { name: /Blake/ })).toBeNull();
  });

  it("names the person when it stands alone", () => {
    // The profile header, where the avatar is the only thing saying whose page
    // this is.
    render(<Avatar src={STORED} name="Blake" size="hero" decorative={false} />);
    expect(screen.getByRole("img", { name: /Blake's profile picture/ })).toBeInTheDocument();
  });

  it("carries the size class the stylesheet needs", () => {
    const { container } = render(<Avatar src={STORED} name="Blake" size="hero" />);
    expect(container.querySelector(".avatar-hero")).not.toBeNull();
  });

  it("passes a non-proxied URL straight through without a srcSet", () => {
    // A legacy or third-party value must keep working rather than becoming a
    // broken image, and offering the same URL as 1x and 2x would be a lie.
    const { container } = render(
      <Avatar src="https://example.com/me.png" name="Blake" decorative={false} />
    );
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("https://example.com/me.png");
    expect(img.getAttribute("srcset")).toBeNull();
  });
});
