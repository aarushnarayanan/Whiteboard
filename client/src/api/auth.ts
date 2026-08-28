export interface Me {
  id: string;
  email: string;
  name: string;
  hasPassword: boolean;
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

export async function forgotPassword(email: string): Promise<void> {
  const res = await fetch("/auth/forgot-password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email }),
  });
  await parseJsonOrThrow(res);
}

export async function resetPassword(token: string, password: string): Promise<Me> {
  const res = await fetch("/auth/reset-password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ token, password }),
  });
  return (await parseJsonOrThrow(res)) as Me;
}

export async function logout(): Promise<void> {
  await fetch("/auth/logout", { method: "POST", credentials: "include" });
}

export async function updateName(name: string): Promise<void> {
  const res = await fetch("/auth/me", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ name }),
  });
  await parseJsonOrThrow(res);
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const res = await fetch("/auth/change-password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  await parseJsonOrThrow(res);
}

export async function deleteAccount(): Promise<void> {
  const res = await fetch("/auth/me", { method: "DELETE", credentials: "include" });
  await parseJsonOrThrow(res);
}

/** Returns the signed-in user, or null if there's no valid session. */
export async function me(): Promise<Me | null> {
  const res = await fetch("/auth/me", { credentials: "include" });
  if (res.status === 401) return null;
  return (await parseJsonOrThrow(res)) as Me;
}
