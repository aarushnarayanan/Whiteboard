import { describe, it, expect } from "vitest";
import { signAccessToken, signRefreshToken, verifyToken } from "./jwt.js";

describe("jwt", () => {
  it("round-trips a signed access token", () => {
    const token = signAccessToken({ sub: "user-1" });
    expect(verifyToken(token).sub).toBe("user-1");
  });

  it("round-trips a signed refresh token", () => {
    const token = signRefreshToken({ sub: "user-2" });
    expect(verifyToken(token).sub).toBe("user-2");
  });

  it("rejects a tampered token", () => {
    const token = signAccessToken({ sub: "user-1" });
    const tampered = token.slice(0, -2) + (token.at(-2) === "a" ? "b" : "a") + token.at(-1);
    expect(() => verifyToken(tampered)).toThrow();
  });
});
