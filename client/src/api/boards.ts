export type BoardRole = "owner" | "editor" | "viewer";

export interface BoardSummary {
  id: string;
  title: string;
  thumbnail: string | null;
  updatedAt: string;
  role: BoardRole;
  starred: boolean;
  tagId: string | null;
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

export class BoardAccessError extends Error {
  status: 404 | 403;
  constructor(status: 404 | 403) {
    super(status === 404 ? "board not found" : "no access to this board");
    this.status = status;
  }
}

export async function getBoard(boardId: string): Promise<BoardSummary> {
  const res = await fetch(`/boards/${boardId}`, { credentials: "include" });
  if (res.status === 404 || res.status === 403) throw new BoardAccessError(res.status);
  return (await parseJsonOrThrow(res)) as BoardSummary;
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

export async function setStarred(boardId: string, starred: boolean): Promise<void> {
  const res = await fetch(`/boards/${boardId}/star`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ starred }),
  });
  await parseJsonOrThrow(res);
}

export async function setTag(boardId: string, tagId: string | null): Promise<void> {
  const res = await fetch(`/boards/${boardId}/tag`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ tagId }),
  });
  await parseJsonOrThrow(res);
}

export async function duplicateBoard(boardId: string): Promise<BoardSummary> {
  const res = await fetch(`/boards/${boardId}/duplicate`, { method: "POST", credentials: "include" });
  return (await parseJsonOrThrow(res)) as BoardSummary;
}

export async function deleteBoard(boardId: string): Promise<void> {
  const res = await fetch(`/boards/${boardId}`, {
    method: "DELETE",
    credentials: "include",
  });
  await parseJsonOrThrow(res);
}

export interface TrashedBoard {
  id: string;
  title: string;
  thumbnail: string | null;
  deletedAt: string;
}

export async function listTrash(): Promise<TrashedBoard[]> {
  const res = await fetch("/boards/trash", { credentials: "include" });
  return (await parseJsonOrThrow(res)) as TrashedBoard[];
}

export async function restoreBoard(boardId: string): Promise<void> {
  const res = await fetch(`/boards/${boardId}/restore`, { method: "POST", credentials: "include" });
  await parseJsonOrThrow(res);
}

export async function permanentlyDeleteBoard(boardId: string): Promise<void> {
  const res = await fetch(`/boards/${boardId}/permanent`, { method: "DELETE", credentials: "include" });
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

export interface BoardMember {
  userId: string;
  email: string;
  name: string;
  role: BoardRole;
}

export async function listMembers(boardId: string): Promise<BoardMember[]> {
  const res = await fetch(`/boards/${boardId}/members`, { credentials: "include" });
  return (await parseJsonOrThrow(res)) as BoardMember[];
}

export async function removeMember(boardId: string, userId: string): Promise<void> {
  const res = await fetch(`/boards/${boardId}/members/${userId}`, {
    method: "DELETE",
    credentials: "include",
  });
  await parseJsonOrThrow(res);
}
