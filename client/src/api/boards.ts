export type BoardRole = "owner" | "editor" | "viewer";

export interface BoardSummary {
  id: string;
  title: string;
  thumbnail: string | null;
  updatedAt: string;
  role: BoardRole;
}

async function parseJsonOrThrow(res: Response): Promise<unknown> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = typeof data === "object" && data !== null && "error" in data ? (data as { error: string }).error : "request failed";
    throw new Error(message);
  }
  return data;
}

export async function listBoards(): Promise<BoardSummary[]> {
  const res = await fetch("/boards", { credentials: "include" });
  return (await parseJsonOrThrow(res)) as BoardSummary[];
}

export async function createBoard(title: string): Promise<BoardSummary> {
  const res = await fetch("/boards", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ title }),
  });
  return (await parseJsonOrThrow(res)) as BoardSummary;
}

export async function uploadThumbnail(boardId: string, dataUrl: string): Promise<void> {
  await fetch(`/boards/${boardId}/thumbnail`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ thumbnail: dataUrl }),
  });
}

export async function renameBoard(boardId: string, title: string): Promise<void> {
  const res = await fetch(`/boards/${boardId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ title }),
  });
  await parseJsonOrThrow(res);
}

export async function deleteBoard(boardId: string): Promise<void> {
  const res = await fetch(`/boards/${boardId}`, {
    method: "DELETE",
    credentials: "include",
  });
  await parseJsonOrThrow(res);
}

export async function inviteMember(boardId: string, email: string, role: "editor" | "viewer"): Promise<void> {
  const res = await fetch(`/boards/${boardId}/members`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email, role }),
  });
  await parseJsonOrThrow(res);
}
