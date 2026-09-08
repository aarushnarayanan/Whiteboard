import { useCallback, useEffect, useState } from "react";
import {
  addReply,
  createThread as apiCreateThread,
  detachThreadAnchor,
  listComments,
  setResolved as apiSetResolved,
  type CommentAnchor,
  type CommentThread,
} from "../api/comments";

// Live updates via a short poll, not a WebSocket channel — comments aren't
// per-keystroke, so a few seconds of latency is an accepted tradeoff for
// reusing plain REST instead of standing up a second realtime transport
// alongside the existing Yjs sync socket.
const POLL_INTERVAL_MS = 4000;

export function useComments(boardId: string) {
  const [threads, setThreads] = useState<CommentThread[]>([]);

  const refetch = useCallback(() => {
    listComments(boardId)
      .then(setThreads)
      .catch(() => {});
  }, [boardId]);

  useEffect(() => {
    refetch();
    const interval = setInterval(refetch, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refetch]);

  const createThread = useCallback(
    (anchor: CommentAnchor, body: string, mentionedUserIds: string[]) => {
      apiCreateThread(boardId, anchor, body, mentionedUserIds)
        .then((thread) => setThreads((list) => [...list, thread]))
        .catch(() => {});
    },
    [boardId],
  );

  const reply = useCallback(
    (threadId: string, body: string, mentionedUserIds: string[]) => {
      addReply(boardId, threadId, body, mentionedUserIds)
        .then((message) =>
          setThreads((list) => list.map((t) => (t.id === threadId ? { ...t, messages: [...t.messages, message] } : t))),
        )
        .catch(() => {});
    },
    [boardId],
  );

  // Both mutations below apply optimistically, then fall back to a refetch
  // if the request actually failed — the same "assume success, reconcile on
  // error" shape as the dashboard's star toggle.
  const resolve = useCallback(
    (threadId: string, resolved: boolean) => {
      setThreads((list) => list.map((t) => (t.id === threadId ? { ...t, resolved } : t)));
      apiSetResolved(boardId, threadId, resolved).catch(refetch);
    },
    [boardId, refetch],
  );

  const detachAnchor = useCallback(
    (threadId: string, x: number, y: number) => {
      setThreads((list) => list.map((t) => (t.id === threadId ? { ...t, x, y, shapeId: null } : t)));
      detachThreadAnchor(boardId, threadId, x, y).catch(refetch);
    },
    [boardId, refetch],
  );

  return { threads, createThread, reply, resolve, detachAnchor };
}
