import { useState } from "react";
import Canvas from "./canvas/Canvas";
import Toolbar from "./canvas/Toolbar";
import type { Tool } from "./canvas/types";
import "./App.css";

// Throwaway stand-in for real sign-in + a board picker (phases 08/09/02
// aren't built yet) -- just enough to manually exercise the sync engine.
function ConnectForm({
  onConnect,
}: {
  onConnect: (boardId: string, role: "editor" | "viewer") => void;
}) {
  const [boardId, setBoardId] = useState("demo-board");
  const [role, setRole] = useState<"editor" | "viewer">("editor");

  return (
    <form
      className="connect-form"
      onSubmit={(e) => {
        e.preventDefault();
        onConnect(boardId, role);
      }}
    >
      <h1>Join a board</h1>
      <input value={boardId} onChange={(e) => setBoardId(e.target.value)} placeholder="Board ID" required />
      <select value={role} onChange={(e) => setRole(e.target.value as "editor" | "viewer")}>
        <option value="editor">Editor</option>
        <option value="viewer">Viewer</option>
      </select>
      <button type="submit">Join</button>
    </form>
  );
}

function App() {
  const [tool, setTool] = useState<Tool>("select");
  const [session, setSession] = useState<{ boardId: string; role: "editor" | "viewer" } | null>(null);

  if (!session) {
    return <ConnectForm onConnect={(boardId, role) => setSession({ boardId, role })} />;
  }

  return (
    <div className="app">
      {session.role === "editor" && <Toolbar tool={tool} onChange={setTool} />}
      <Canvas
        boardId={session.boardId}
        role={session.role}
        tool={tool}
        onToolUsed={() => setTool("select")}
      />
    </div>
  );
}

export default App;
