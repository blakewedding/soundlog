import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ListEditor } from "./ListEditor";
import { api, type ListDTO } from "../../services/api";

vi.mock("../../services/api", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../services/api")>();
  return {
    ...mod,
    api: {
      ...mod.api,
      reorderList: vi.fn(),
      updateListItemNote: vi.fn(),
      removeListItem: vi.fn(),
      updateList: vi.fn(),
    },
  };
});

const mockedReorder = vi.mocked(api.reorderList);
const mockedNote = vi.mocked(api.updateListItemNote);

function list(): ListDTO {
  return {
    id: "l1",
    title: "Essential DJ Mixes",
    description: null,
    isPublic: true,
    isRanked: true,
    user: { id: "me", username: "blake" },
    items: [
      {
        releaseId: "rA",
        position: 1,
        note: null,
        release: { id: "rA", title: "Liquid Room", artistName: "Jeff Mills", type: "DJ_MIX", year: "1996" },
      },
      {
        releaseId: "rB",
        position: 2,
        note: "criminally underrated",
        release: { id: "rB", title: "Drug Store Core Boy", artistName: "La Peste", type: "DJ_MIX", year: "2000" },
      },
    ],
  };
}

function renderEditor(onChanged = vi.fn()) {
  render(
    <MemoryRouter>
      <ListEditor list={list()} editable onChanged={onChanged} />
    </MemoryRouter>
  );
  return onChanged;
}

beforeEach(() => {
  mockedReorder.mockReset();
  mockedNote.mockReset();
});

describe("ListEditor", () => {
  it("reorders by committing the complete swapped permutation", async () => {
    const user = userEvent.setup();
    mockedReorder.mockResolvedValue(undefined);
    const onChanged = renderEditor();

    // Move the first item down.
    await user.click(screen.getAllByRole("button", { name: "Move down" })[0]);
    await waitFor(() => expect(mockedReorder).toHaveBeenCalledWith("l1", ["rB", "rA"]));
    expect(onChanged).toHaveBeenCalled();
  });

  it("disables the impossible moves at the edges", () => {
    renderEditor();
    expect(screen.getAllByRole("button", { name: "Move up" })[0]).toBeDisabled();
    expect(screen.getAllByRole("button", { name: "Move down" })[1]).toBeDisabled();
  });

  it("edits an item note inline and clears it when emptied", async () => {
    const user = userEvent.setup();
    mockedNote.mockResolvedValue({ item: {} });
    renderEditor();

    // rA has no note → "Add note"; rB has one → "Edit note".
    await user.click(screen.getByRole("button", { name: "Add note" }));
    await user.type(screen.getByRole("textbox", { name: "Item note" }), "opening salvo");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockedNote).toHaveBeenCalledWith("l1", "rA", "opening salvo"));

    await user.click(screen.getByRole("button", { name: "Edit note" }));
    const box = screen.getByRole("textbox", { name: "Item note" });
    await user.clear(box);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockedNote).toHaveBeenLastCalledWith("l1", "rB", null));
  });

  it("shows existing notes", () => {
    renderEditor();
    expect(screen.getByText("criminally underrated")).toBeInTheDocument();
  });
});
