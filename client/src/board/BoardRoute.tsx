import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Canvas, { isEditableFocused, type CanvasHandle, type ExportPngOptions } from "../canvas/Canvas";
import Toolbar from "../canvas/Toolbar";
import BoardHeader from "../canvas/BoardHeader";
import type { Tool } from "../canvas/types";
import type { Me } from "../api/auth";
import { BoardAccessError, getBoard, uploadThumbnail, type BoardSummary } from "../api/boards";

type State =
  | { status: "loading" }
  | { status: "error"; kind: 404 | 403 }
  | { status: "ready"; board: BoardSummary };

export default function BoardRoute({ me }: { me: Me }) {
  const { boardId } = useParams<{ boardId: string }>();
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ status: "loading" });
  const [tool, setTool] = useState<Tool>("select");
  const [stickyColor, setStickyColor] = useState("#fff3c4");
  const [history, setHistory] = useState({ canUndo: false, canRedo: false });
  const [selectionCount, setSelectionCount] = useState(0);
  const canvasRef = useRef<CanvasHandle>(null);

  useEffect(() => {
    setState({ status: "loading" });
    setTool("select");
    setHistory({ canUndo: false, canRedo: false });
    getBoard(boardId!)
      .then((board) => setState({ status: "ready", board }))
      .catch((err) => setState({ status: "error", kind: err instanceof BoardAccessError ? err.status : 404 }));
  }, [boardId]);

  // Lives here rather than in Canvas because the filename comes from the board
  // title, which the canvas has no reason to know.
  const handleExportPng = useCallback(
    (options: ExportPngOptions): string | null => {
      const dataUrl = canvasRef.current?.exportPNG(options) ?? null;
      if (!dataUrl || state.status !== "ready") return null;

      const date = new Date().toISOString().slice(0, 10);
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = `${state.status === "ready" ? state.board.title : "Board"} — ${date}.png`;
      link.click();
      return dataUrl;
    },
    [state],
  );

  // Export has to work for a viewer too, so this isn't gated on role.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (isEditableFocused()) return;
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "e") {
        e.preventDefault();
        handleExportPng({ scope: "board", scale: 2, background: "white" });
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleExportPng]);

  function handleBack() {
    if (state.status === "ready" && state.board.role !== "viewer") {
      const dataUrl = canvasRef.current?.captureThumbnail();
      if (dataUrl) uploadThumbnail(state.board.id, dataUrl).catch(() => {});
    }
    navigate("/");
  }

  if (state.status === "loading") return null;

  if (state.status === "error") {
    return (
      <div className="board-access-error">
        {state.kind === 404 ? (
          <>
            <h1>Board not found</h1>
            <p>This board may have been deleted, or the link is incorrect.</p>
          </>
        ) : (
          <>
            <h1>You don't have access to this board</h1>
            <p>Ask whoever shared this with you to invite {me.email} as a collaborator.</p>
          </>
        )}
        <Link to="/">Back to your boards</Link>
      </div>
    );
  }

  const { board } = state;
  const canEdit = board.role !== "viewer";

  return (
    <div className="app" key={boardId}>
      <BoardHeader
        board={board}
        onBack={handleBack}
        onRenamed={(title) => setState((s) => (s.status === "ready" ? { status: "ready", board: { ...s.board, title } } : s))}
        onDeleted={() => navigate("/")}
        onDuplicated={(newBoard) => navigate(`/b/${newBoard.id}`)}
        onTagged={(tagId) => setState((s) => (s.status === "ready" ? { status: "ready", board: { ...s.board, tagId } } : s))}
        onExportPng={handleExportPng}
        selectionCount={selectionCount}
      />
      <div className="board-canvas-area">
        <Canvas
          ref={canvasRef}
          boardId={board.id}
          role={board.role}
          tool={tool}
          onToolUsed={() => setTool("select")}
          onHistoryChange={setHistory}
          onSelectionChange={setSelectionCount}
          me={me}
          stickyColor={stickyColor}
        />
        {canEdit && (
          <Toolbar
            tool={tool}
            onChange={setTool}
            canUndo={history.canUndo}
            canRedo={history.canRedo}
            onUndo={() => canvasRef.current?.undo()}
            onRedo={() => canvasRef.current?.redo()}
            stickyColor={stickyColor}
            onStickyColorChange={setStickyColor}
            onPickImages={(files) => canvasRef.current?.insertImageFiles(files)}
          />
        )}
      </div>
    </div>
  );
}
