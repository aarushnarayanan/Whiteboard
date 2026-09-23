import { useCallback, useState } from "react";
import {
  branchVersion,
  listVersions,
  previewVersion,
  restoreVersion,
  saveVersion as apiSaveVersion,
  type BoardVersion,
  type BranchedBoard,
} from "../api/versions";
import type { ShapeObj } from "../canvas/types";

// Versions change far less often than comments — saved explicitly, or once
// per session on close — so this fetches on demand (call refetch when the
// history panel opens) rather than polling on an interval.
export function useVersions(boardId: string) {
  const [versions, setVersions] = useState<BoardVersion[]>([]);

  const refetch = useCallback(() => {
    listVersions(boardId)
      .then(setVersions)
      .catch(() => {});
  }, [boardId]);

  // Save/restore/branch are deliberate, one-shot actions with no other error
  // surface — unlike the optimistic-then-reconcile pattern comments use,
  // these propagate rejections so the caller can show the user what failed.
  const save = useCallback(
    async (label: string) => {
      await apiSaveVersion(boardId, label);
      refetch();
    },
    [boardId, refetch],
  );

  const restore = useCallback(
    async (versionId: string) => {
      await restoreVersion(boardId, versionId);
      refetch();
    },
    [boardId, refetch],
  );

  const branch = useCallback((versionId: string): Promise<BranchedBoard> => branchVersion(boardId, versionId), [boardId]);

  const preview = useCallback((versionId: string): Promise<ShapeObj[]> => previewVersion(boardId, versionId), [boardId]);

  return { versions, refetch, save, restore, branch, preview };
}
