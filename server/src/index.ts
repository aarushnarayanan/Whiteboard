import { createBoardServer } from "./httpServer.js";

const port = process.env.PORT ?? 3001;

createBoardServer().listen(port, () => {
  console.log(`server listening on :${port}`);
});
