export interface Tag {
  id: string;
  name: string;
}

async function parseJsonOrThrow(res: Response): Promise<unknown> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = typeof data === "object" && data !== null && "error" in data ? (data as { error: string }).error : "request failed";
    throw new Error(message);
  }
  return data;
}

export async function listTags(): Promise<Tag[]> {
  const res = await fetch("/tags", { credentials: "include" });
  return (await parseJsonOrThrow(res)) as Tag[];
}

export async function createTag(name: string): Promise<Tag> {
  const res = await fetch("/tags", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ name }),
  });
  return (await parseJsonOrThrow(res)) as Tag;
}

export async function deleteTag(id: string): Promise<void> {
  const res = await fetch(`/tags/${id}`, { method: "DELETE", credentials: "include" });
  await parseJsonOrThrow(res);
}
