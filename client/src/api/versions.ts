import type { ShapeObj } from "../canvas/types";

export interface VersionContributor {
  id: string;
  name: string;
}

export interface BoardVersion {
  id: string;
  label: string | null;
  createdAt: string;
  contributors: VersionContributor[];
}

async function parseJsonOrThrow(res: Response): Promise<unknown> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = typeof data === "object" && data !== null && "error" in data ? (data as { error: string }).error : "request failed";
    throw new Error(message);
  }
  return data;
}

export async function listVersions(boardId: string): Promise<BoardVersion[]> {
  const res = await fetch(`/boards/${boardId}/versions`, { credentials: "include" });
  return (await parseJsonOrThrow(res)) as BoardVersion[];
}

export async function previewVersion(boardId: string, versionId: string): Promise<ShapeObj[]> {
  const res = await fetch(`/boards/${boardId}/versions/${versionId}/preview`, { credentials: "include" });
  const data = (await parseJsonOrThrow(res)) as { shapes: ShapeObj[] };
  return data.shapes;
}

export async function saveVersion(boardId: string, label: string): Promise<BoardVersion> {
  const res = await fetch(`/boards/${boardId}/versions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ label }),
  });
  const data = (await parseJsonOrThrow(res)) as { id: string };
  return { id: data.id, label, createdAt: new Date().toISOString(), contributors: [] };
}

export async function restoreVersion(boardId: string, versionId: string): Promise<void> {
  const res = await fetch(`/boards/${boardId}/versions/${versionId}/restore`, {
    method: "POST",
    credentials: "include",
  });
  await parseJsonOrThrow(res);
}

export interface BranchedBoard {
  id: string;
  title: string;
}

export async function branchVersion(boardId: string, versionId: string): Promise<BranchedBoard> {
  const res = await fetch(`/boards/${boardId}/versions/${versionId}/branch`, {
    method: "POST",
    credentials: "include",
  });
  return (await parseJsonOrThrow(res)) as BranchedBoard;
}
