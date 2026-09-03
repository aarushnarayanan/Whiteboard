import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Canvas, { type CanvasHandle } from "../canvas/Canvas";
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
  const canvasRef = useRef<CanvasHandle>(null);

  useEffect(() => {
    setState({ status: "loading" });
    setTool("select");
    setHistory({ canUndo: false, canRedo: false });
    getBoard(boardId!)
      .then((board) => setState({ status: "ready", board }))
      .catch((err) => setState({ status: "error", kind: err instanceof BoardAccessError ? err.status : 404 }));
  }, [boardId]);

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
      />
      <div className="board-canvas-area">
        <Canvas
          ref={canvasRef}
          boardId={board.id}
          role={board.role}
          tool={tool}
          onToolUsed={() => setTool("select")}
          onHistoryChange={setHistory}
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
          />
        )}
      </div>
    </div>
  );
}
