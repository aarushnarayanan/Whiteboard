import { createBoardServer } from "./httpServer.js";

const port = process.env.PORT ?? 3001;

// The R2 client in r2.ts is built lazily so the test suite can run without
// these set — which means a missing/blank value would otherwise boot clean
// and only fail at the first image upload, as a bare 500 in front of a user.
// Checked here rather than in r2.ts itself so tests (which import httpServer
// directly, not this entrypoint) never see it.
const missingR2Vars = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"].filter(
  (name) => !process.env[name],
);
if (missingR2Vars.length > 0) {
  console.warn(`R2 is not configured (missing ${missingR2Vars.join(", ")}) — image upload/read will fail`);
}

createBoardServer().listen(port, () => {
  console.log(`server listening on :${port}`);
});
