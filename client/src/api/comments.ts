export interface CommentMessage {
  id: string;
  threadId: string;
  authorId: string;
  authorName: string;
  body: string;
  mentionedUserIds: string[];
  createdAt: string;
}

// A thread pins to exactly one of a fixed canvas point or a shape — x/y are
// both set or both null, shapeId is set only when x/y aren't.
export interface CommentThread {
  id: string;
  authorId: string;
  authorName: string;
  x: number | null;
  y: number | null;
  shapeId: string | null;
  resolved: boolean;
  createdAt: string;
  messages: CommentMessage[];
}

export type CommentAnchor = { x: number; y: number } | { shapeId: string };

async function parseJsonOrThrow(res: Response): Promise<unknown> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = typeof data === "object" && data !== null && "error" in data ? (data as { error: string }).error : "request failed";
    throw new Error(message);
  }
  return data;
}

export async function listComments(boardId: string): Promise<CommentThread[]> {
  const res = await fetch(`/boards/${boardId}/comments`, { credentials: "include" });
  return (await parseJsonOrThrow(res)) as CommentThread[];
}

export async function createThread(
  boardId: string,
  anchor: CommentAnchor,
  body: string,
  mentionedUserIds: string[],
): Promise<CommentThread> {
  const res = await fetch(`/boards/${boardId}/comments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ ...anchor, body, mentionedUserIds }),
  });
  return (await parseJsonOrThrow(res)) as CommentThread;
}

export async function addReply(
  boardId: string,
  threadId: string,
  body: string,
  mentionedUserIds: string[],
): Promise<CommentMessage> {
  const res = await fetch(`/boards/${boardId}/comments/${threadId}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ body, mentionedUserIds }),
  });
  return (await parseJsonOrThrow(res)) as CommentMessage;
}

export async function setResolved(boardId: string, threadId: string, resolved: boolean): Promise<void> {
  const res = await fetch(`/boards/${boardId}/comments/${threadId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ resolved }),
  });
  await parseJsonOrThrow(res);
}

// Called when the shape a thread is pinned to is about to be deleted — pins
// it to that shape's last on-screen position instead, the same "detach to
// last resolved position" treatment a bound connector already gets.
export async function detachThreadAnchor(boardId: string, threadId: string, x: number, y: number): Promise<void> {
  const res = await fetch(`/boards/${boardId}/comments/${threadId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ x, y }),
  });
  await parseJsonOrThrow(res);
}
