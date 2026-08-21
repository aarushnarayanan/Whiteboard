export interface Me {
  id: string;
  email: string;
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

export async function signup(email: string, name: string, password: string): Promise<Me> {
  const res = await fetch("/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email, name, password }),
  });
  return (await parseJsonOrThrow(res)) as Me;
}

export async function login(email: string, password: string): Promise<Me> {
  const res = await fetch("/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email, password }),
  });
  return (await parseJsonOrThrow(res)) as Me;
}

export async function logout(): Promise<void> {
  await fetch("/auth/logout", { method: "POST", credentials: "include" });
}

/** Returns the signed-in user, or null if there's no valid session. */
export async function me(): Promise<Me | null> {
  const res = await fetch("/auth/me", { credentials: "include" });
  if (res.status === 401) return null;
  return (await parseJsonOrThrow(res)) as Me;
}
