import { and, desc, eq, gt, isNotNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { boardUpdates, boardVersions } from "../db/schema.js";

// Contributors are computed once, here, rather than joined on every read —
// board_updates rows this reads are themselves routinely deleted by
// compaction, so this is a best-effort snapshot of "who touched it since the
// last version," not a durable audit trail.
async function contributorsSince(boardId: string, since: Date | undefined): Promise<string[]> {
  const rows = await db
    .selectDistinct({ userId: boardUpdates.userId })
    .from(boardUpdates)
    .where(and(eq(boardUpdates.boardId, boardId), isNotNull(boardUpdates.userId), since ? gt(boardUpdates.createdAt, since) : undefined));
  return rows.map((r) => r.userId).filter((id): id is string => id !== null);
}

/** Returns the new version's id, or null if an auto-snapshot was skipped
 *  because nothing changed since the previous version — otherwise every
 *  look-then-close session with zero edits would still grow the table. A
 *  named version always saves regardless: it's a deliberate checkpoint.
 *
 *  `force` bypasses the skip check entirely — used for the safety-net
 *  snapshot taken right before a restore. That check is "were there
 *  attributed edits since the last version," a fine proxy for "did a normal
 *  editing session happen," but restore's safety net needs to be correct
 *  about a different question — "does the current state actually differ
 *  from what's about to be overwritten" — so it can't rely on the same
 *  attribution-based shortcut without risking a silently-skipped safety net. */
export async function saveVersion(
  boardId: string,
  snapshot: Buffer,
  label: string | null,
  { force = false }: { force?: boolean } = {},
): Promise<string | null> {
  const [lastVersion] = await db
    .select({ createdAt: boardVersions.createdAt })
    .from(boardVersions)
    .where(eq(boardVersions.boardId, boardId))
    .orderBy(desc(boardVersions.createdAt))
    .limit(1);

  const contributorIds = await contributorsSince(boardId, lastVersion?.createdAt);
  if (!force && label === null && lastVersion && contributorIds.length === 0) return null;

  const [version] = await db.insert(boardVersions).values({ boardId, snapshot, label, contributorIds }).returning({ id: boardVersions.id });
  return version.id;
}
