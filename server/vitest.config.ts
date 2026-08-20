import { defineConfig } from "vitest/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(dir, ".env");

let envContent: string;
try {
  envContent = readFileSync(envPath, "utf-8");
} catch (err) {
  if ((err as NodeJS.ErrnoException).code === "ENOENT") {
    throw new Error(
      `Missing ${envPath}. Copy the template: cp .env.example server/.env`
    );
  }
  throw err;
}

// Parse .env file
const env: Record<string, string> = {};
envContent.split("\n").forEach((line) => {
  const trimmed = line.trim();
  if (trimmed && !trimmed.startsWith("#")) {
    const eq = trimmed.indexOf("=");
    if (eq !== -1) {
      const key = trimmed.slice(0, eq);
      const value = trimmed.slice(eq + 1);
      if (key) {
        env[key] = value;
      }
    }
  }
});

export default defineConfig({
  test: {
    env,
  },
});
