import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/database.js";
import { validate } from "../middleware/validate.js";
import { requireAuth, optionalAuth, type AuthedRequest } from "../middleware/auth.js";
import { HttpError } from "../middleware/errorHandler.js";
import { emitActivity } from "../jobs/activityQueue.js";
import { indexList, deindexList } from "../services/searchService.js";

export const listsRouter = Router();

// Re-index a list for search after any change to its fields, membership, or
// visibility. indexList de-indexes automatically when the list isn't public.
async function syncListIndex(listId: string): Promise<void> {
  const list = await prisma.list.findUnique({
    where: { id: listId },
    include: { user: { select: { username: true } }, _count: { select: { items: true } } },
  });
  if (!list) return;
  await indexList({
    id: list.id,
    title: list.title,
    description: list.description,
    isPublic: list.isPublic,
    username: list.user.username,
    itemCount: list._count.items,
  });
}

const publicUser = { select: { id: true, username: true, displayName: true, avatarUrl: true } };
const listItemRelease = {
  select: { id: true, title: true, artistName: true, coverUrl: true, type: true, releaseDate: true },
};

const createListSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().max(2_000).optional(),
  isRanked: z.boolean().optional(),
  isPublic: z.boolean().optional(),
});

const updateListSchema = createListSchema.partial();

const addItemSchema = z.object({
  releaseId: z.string().min(1),
  note: z.string().max(1_000).optional(),
});

const reorderSchema = z.object({
  // Complete ordering of the list's releaseIds, first = position 1.
  order: z.array(z.string().min(1)).min(1),
});

async function ownedList(listId: string, userId: string) {
  const list = await prisma.list.findUnique({ where: { id: listId } });
  if (!list) throw new HttpError(404, "List not found");
  if (list.userId !== userId) throw new HttpError(403, "Not your list");
  return list;
}

function toListDTO(list: {
  id: string;
  title: string;
  description: string | null;
  isPublic: boolean;
  isRanked: boolean;
  createdAt: Date;
  updatedAt: Date;
  user?: { id: string; username: string; displayName: string | null; avatarUrl: string | null };
  _count?: { items: number };
}) {
  return {
    id: list.id,
    title: list.title,
    description: list.description,
    isPublic: list.isPublic,
    isRanked: list.isRanked,
    user: list.user,
    itemCount: list._count?.items,
    createdAt: list.createdAt,
    updatedAt: list.updatedAt,
  };
}

// POST /api/lists — create a list.
listsRouter.post("/", requireAuth, validate(createListSchema), async (req: AuthedRequest, res, next) => {
  try {
    const list = await prisma.list.create({
      data: {
        userId: req.userId!,
        title: req.body.title,
        description: req.body.description,
        isRanked: req.body.isRanked ?? false,
        isPublic: req.body.isPublic ?? true,
      },
      include: { user: publicUser, _count: { select: { items: true } } },
    });
    // Only public lists ever reach the feed (privacy enforced at hydration too).
    if (list.isPublic) await emitActivity({ userId: req.userId!, type: "LIST_CREATE", targetId: list.id });
    await syncListIndex(list.id);
    res.status(201).json({ list: toListDTO(list) });
  } catch (err) {
    next(err);
  }
});

// GET /api/lists — recent public lists (plus my own when authed).
listsRouter.get("/", optionalAuth, async (req: AuthedRequest, res, next) => {
  try {
    const lists = await prisma.list.findMany({
      where: req.userId ? { OR: [{ isPublic: true }, { userId: req.userId }] } : { isPublic: true },
      orderBy: { updatedAt: "desc" },
      take: Math.min(Number(req.query.limit) || 25, 100),
      include: { user: publicUser, _count: { select: { items: true } } },
    });
    res.json({ lists: lists.map(toListDTO) });
  } catch (err) {
    next(err);
  }
});

// GET /api/lists/:id — a list with its items in order.
listsRouter.get("/:id", optionalAuth, async (req: AuthedRequest, res, next) => {
  try {
    const list = await prisma.list.findUnique({
      where: { id: req.params.id },
      include: {
        user: publicUser,
        _count: { select: { items: true } },
        items: { orderBy: { position: "asc" }, include: { release: listItemRelease } },
      },
    });
    if (!list) throw new HttpError(404, "List not found");
    if (!list.isPublic && list.userId !== req.userId) throw new HttpError(404, "List not found");

    res.json({
      list: {
        ...toListDTO(list),
        items: list.items.map((i) => ({
          releaseId: i.releaseId,
          position: i.position,
          note: i.note,
          release: {
            ...i.release,
            year: i.release.releaseDate?.toISOString().slice(0, 4) ?? null,
            releaseDate: undefined,
          },
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/lists/:id — edit title/description/flags.
listsRouter.patch("/:id", requireAuth, validate(updateListSchema), async (req: AuthedRequest, res, next) => {
  try {
    const list = await ownedList(req.params.id, req.userId!);
    const updated = await prisma.list.update({
      where: { id: list.id },
      data: req.body,
      include: { user: publicUser, _count: { select: { items: true } } },
    });
    // Title/description/visibility may all have changed — re-index (or remove
    // from the index if the list just went private).
    await syncListIndex(updated.id);
    res.json({ list: toListDTO(updated) });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/lists/:id — items cascade in the DB.
listsRouter.delete("/:id", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const list = await ownedList(req.params.id, req.userId!);
    await prisma.list.delete({ where: { id: list.id } });
    await deindexList(list.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// POST /api/lists/:id/items — append a release to the end of the list.
listsRouter.post("/:id/items", requireAuth, validate(addItemSchema), async (req: AuthedRequest, res, next) => {
  try {
    const list = await ownedList(req.params.id, req.userId!);
    const release = await prisma.release.findUnique({
      where: { id: req.body.releaseId },
      select: { id: true },
    });
    if (!release) throw new HttpError(404, "Release not found");

    const last = await prisma.listItem.aggregate({
      where: { listId: list.id },
      _max: { position: true },
    });
    const item = await prisma.listItem.create({
      data: {
        listId: list.id,
        releaseId: release.id,
        position: (last._max.position ?? 0) + 1,
        note: req.body.note,
      },
      include: { release: listItemRelease },
    });
    if (list.isPublic) await emitActivity({ userId: req.userId!, type: "LIST_ITEM_ADD", targetId: list.id });
    await syncListIndex(list.id); // itemCount changed
    res.status(201).json({ item });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") {
      return next(new HttpError(409, "That release is already on this list"));
    }
    next(err);
  }
});

// PUT /api/lists/:id/items — reorder: body carries the complete new order.
listsRouter.put("/:id/items", requireAuth, validate(reorderSchema), async (req: AuthedRequest, res, next) => {
  try {
    const list = await ownedList(req.params.id, req.userId!);
    const items = await prisma.listItem.findMany({ where: { listId: list.id } });
    const current = new Set(items.map((i) => i.releaseId));
    const proposed: string[] = req.body.order;

    if (proposed.length !== current.size || !proposed.every((id) => current.has(id))) {
      throw new HttpError(422, "Order must contain each list item exactly once");
    }

    await prisma.$transaction(async (tx) => {
      // Two passes so intermediate states never collide on the position index.
      for (let i = 0; i < proposed.length; i++) {
        await tx.listItem.update({
          where: { listId_releaseId: { listId: list.id, releaseId: proposed[i] } },
          data: { position: -(i + 1) },
        });
      }
      for (let i = 0; i < proposed.length; i++) {
        await tx.listItem.update({
          where: { listId_releaseId: { listId: list.id, releaseId: proposed[i] } },
          data: { position: i + 1 },
        });
      }
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// PATCH /api/lists/:id/items/:releaseId — edit an item's note (null clears it).
const noteSchema = z.object({ note: z.string().max(1_000).nullable() });

listsRouter.patch(
  "/:id/items/:releaseId",
  requireAuth,
  validate(noteSchema),
  async (req: AuthedRequest, res, next) => {
    try {
      const list = await ownedList(req.params.id, req.userId!);
      const item = await prisma.listItem.findUnique({
        where: { listId_releaseId: { listId: list.id, releaseId: req.params.releaseId } },
      });
      if (!item) throw new HttpError(404, "That release isn't on this list");
      const updated = await prisma.listItem.update({
        where: { id: item.id },
        data: { note: req.body.note },
        include: { release: listItemRelease },
      });
      res.json({ item: updated });
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /api/lists/:id/items/:releaseId — remove and close the position gap.
listsRouter.delete("/:id/items/:releaseId", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const list = await ownedList(req.params.id, req.userId!);
    await prisma.$transaction(async (tx) => {
      const removed = await tx.listItem.deleteMany({
        where: { listId: list.id, releaseId: req.params.releaseId },
      });
      if (removed.count > 0) {
        const rest = await tx.listItem.findMany({
          where: { listId: list.id },
          orderBy: { position: "asc" },
        });
        for (let i = 0; i < rest.length; i++) {
          if (rest[i].position !== i + 1) {
            await tx.listItem.update({ where: { id: rest[i].id }, data: { position: i + 1 } });
          }
        }
      }
    });
    await syncListIndex(list.id); // itemCount changed
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
