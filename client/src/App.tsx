import { useEffect, useRef, useState } from "react";
import Canvas, { type CanvasHandle } from "./canvas/Canvas";
import Toolbar from "./canvas/Toolbar";
import BoardHeader from "./canvas/BoardHeader";
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
  const [history, setHistory] = useState({ canUndo: false, canRedo: false });
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
    setHistory({ canUndo: false, canRedo: false });
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
    return <Dashboard me={me} onOpenBoard={setOpenBoard} onLogout={handleLogout} />;
  }

  const canEdit = openBoard.role !== "viewer";

  return (
    <div className="app">
      <BoardHeader
        board={openBoard}
        onBack={handleBack}
        onRenamed={(title) => setOpenBoard((b) => (b ? { ...b, title } : b))}
        onDeleted={() => setOpenBoard(null)}
      />
      <div className="board-canvas-area">
        <Canvas
          ref={canvasRef}
          boardId={openBoard.id}
          role={openBoard.role}
          tool={tool}
          onToolUsed={() => setTool("select")}
          onHistoryChange={setHistory}
        />
        {canEdit && (
          <Toolbar
            tool={tool}
            onChange={setTool}
            canUndo={history.canUndo}
            canRedo={history.canRedo}
            onUndo={() => canvasRef.current?.undo()}
            onRedo={() => canvasRef.current?.redo()}
          />
        )}
      </div>
    </div>
  );
}

export default App;
