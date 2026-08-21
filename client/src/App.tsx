import { useEffect, useRef, useState } from "react";
import Canvas, { type CanvasHandle } from "./canvas/Canvas";
import Toolbar from "./canvas/Toolbar";
import type { Tool } from "./canvas/types";
import LoginForm from "./auth/LoginForm";
import Dashboard from "./dashboard/Dashboard";
import { logout, me as fetchMe, type Me } from "./api/auth";
import { uploadThumbnail, type BoardSummary } from "./api/boards";
import "./App.css";

function App() {
  const [tool, setTool] = useState<Tool>("select");
  const [me, setMe] = useState<Me | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [openBoard, setOpenBoard] = useState<BoardSummary | null>(null);
  const canvasRef = useRef<CanvasHandle>(null);

  useEffect(() => {
    fetchMe()
      .then(setMe)
      .finally(() => setCheckingSession(false));
  }, []);

  function handleBack() {
    if (openBoard && openBoard.role !== "viewer") {
      const dataUrl = canvasRef.current?.captureThumbnail();
      if (dataUrl) uploadThumbnail(openBoard.id, dataUrl).catch(() => {});
    }
    setOpenBoard(null);
    setTool("select");
  }

  async function handleLogout() {
    await logout();
    setMe(null);
    setOpenBoard(null);
  }

  if (checkingSession) return null;

  if (!me) {
    return <LoginForm onAuthed={setMe} />;
  }

  if (!openBoard) {
    return (
      <div className="app">
        <Dashboard onOpenBoard={setOpenBoard} />
        <button type="button" className="logout-button" onClick={handleLogout}>
          Log out
        </button>
      </div>
    );
  }

  const canEdit = openBoard.role !== "viewer";

  return (
    <div className="app">
      <div className="board-toolbar-row">
        <button type="button" onClick={handleBack}>
          ← Boards
        </button>
        {canEdit && <Toolbar tool={tool} onChange={setTool} />}
      </div>
      <Canvas
        ref={canvasRef}
        boardId={openBoard.id}
        role={openBoard.role}
        tool={tool}
        onToolUsed={() => setTool("select")}
      />
    </div>
  );
}

export default App;
