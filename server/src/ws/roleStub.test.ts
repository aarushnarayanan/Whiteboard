import { describe, it, expect } from "vitest";
import type { IncomingMessage } from "node:http";
import { authenticateWSRequest } from "./roleStub.js";

function req(url: string): IncomingMessage {
  return { url } as IncomingMessage;
}

describe("authenticateWSRequest", () => {
  it("extracts board id and role from a valid URL", () => {
    const result = authenticateWSRequest(req("/ws/boards/abc123?role=editor"));
    expect(result).toEqual({ boardId: "abc123", role: "editor" });
  });

  it("rejects a missing role", () => {
    expect(authenticateWSRequest(req("/ws/boards/abc123"))).toBeNull();
  });

  it("rejects an invalid role", () => {
    expect(authenticateWSRequest(req("/ws/boards/abc123?role=admin"))).toBeNull();
  });

  it("rejects a non-matching path", () => {
    expect(authenticateWSRequest(req("/health"))).toBeNull();
  });
});
