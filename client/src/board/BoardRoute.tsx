import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import Canvas, { isEditableFocused, type CanvasHandle, type ExportPngOptions } from "../canvas/Canvas";
import Toolbar from "../canvas/Toolbar";
import BoardHeader from "../canvas/BoardHeader";
import type { ClipboardPayload, ShapeObj, ShapeType, Tool, ToolStyles } from "../canvas/types";
import type { Me } from "../api/auth";
import { BoardAccessError, getBoard, listMembers, uploadThumbnail, type BoardMember, type BoardSummary } from "../api/boards";
import { useComments } from "./useComments";
import { useVersions } from "./useVersions";

type State =
  | { status: "loading" }
  | { status: "error"; kind: 404 | 403 }
  | { status: "ready"; board: BoardSummary };

const DEFAULT_TOOL_STYLES: ToolStyles = {
  sticky: { color: "#fff3c4" },
  shape: {},
  pen: { stroke: "oklch(55% 0.18 250)", strokeWidth: 2.5 },
  connector: {},
  text: {},
};

// Which ToolStyles bucket a shape's own creation tool reads/writes — image
// and table have no style memory (nothing in F2's scope for either).
function toolStylesKey(type: ShapeType): keyof ToolStyles | null {
  if (type === "sticky") return "sticky";
  if (type === "pen") return "pen";
  if (type === "line" || type === "arrow") return "connector";
  if (type === "text") return "text";
  if (type === "rect" || type === "ellipse" || type === "star" || type === "hexagon" || type === "frame") return "shape";
  return null;
}

// Only merges the fields each bucket actually declares — a patch aimed at
// one bucket (e.g. a text-formatting change) shouldn't leak unrelated
// fields into another shape type's remembered style.
function mergeIntoBucket(prev: ToolStyles, key: keyof ToolStyles, patch: Partial<ShapeObj>): ToolStyles {
  switch (key) {
    case "sticky":
      return patch.color !== undefined ? { ...prev, sticky: { color: patch.color } } : prev;
    case "shape":
      return {
        ...prev,
        shape: {
          ...prev.shape,
          ...(patch.color !== undefined ? { color: patch.color } : {}),
          ...(patch.stroke !== undefined ? { stroke: patch.stroke } : {}),
          ...(patch.strokeWidth !== undefined ? { strokeWidth: patch.strokeWidth } : {}),
        },
      };
    case "pen":
      return {
        ...prev,
        pen: {
          stroke: patch.stroke ?? prev.pen.stroke,
          strokeWidth: patch.strokeWidth ?? prev.pen.strokeWidth,
        },
      };
    case "connector":
      return {
        ...prev,
        connector: {
          ...prev.connector,
          ...(patch.stroke !== undefined ? { stroke: patch.stroke } : {}),
          ...(patch.strokeWidth !== undefined ? { strokeWidth: patch.strokeWidth } : {}),
          ...(patch.arrowStart !== undefined ? { arrowStart: patch.arrowStart } : {}),
          ...(patch.arrowEnd !== undefined ? { arrowEnd: patch.arrowEnd } : {}),
          ...(patch.routing !== undefined ? { routing: patch.routing } : {}),
        },
      };
    case "text":
      return {
        ...prev,
        text: {
          ...prev.text,
          ...(patch.fontSize !== undefined ? { fontSize: patch.fontSize } : {}),
          ...(patch.bold !== undefined ? { bold: patch.bold } : {}),
          ...(patch.italic !== undefined ? { italic: patch.italic } : {}),
          ...(patch.align !== undefined ? { align: patch.align } : {}),
          ...(patch.textColor !== undefined ? { textColor: patch.textColor } : {}),
        },
      };
  }
}

interface BoardRouteProps {
  me: Me;
  // Owned by App.tsx, not here — "/" and "/b/:boardId" are sibling routes,
  // so BoardRoute itself fully unmounts going board -> dashboard -> a
  // different board. A clipboard living here wouldn't survive that, the
  // realistic "switch boards" path; App never unmounts within the session.
  clipboard: ClipboardPayload | null;
  onCopy: (payload: ClipboardPayload) => void;
}

export default function BoardRoute({ me, clipboard, onCopy }: BoardRouteProps) {
  const { boardId } = useParams<{ boardId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [state, setState] = useState<State>({ status: "loading" });
  const [tool, setTool] = useState<Tool>("select");
  const [toolStyles, setToolStyles] = useState<ToolStyles>(DEFAULT_TOOL_STYLES);
  const [history, setHistory] = useState({ canUndo: false, canRedo: false });
  const [selectionCount, setSelectionCount] = useState(0);
  const [members, setMembers] = useState<BoardMember[]>([]);
  const canvasRef = useRef<CanvasHandle>(null);
  const { threads, createThread, reply, resolve, detachAnchor } = useComments(boardId!);
  const { versions, refetch: refetchVersions, save: saveVersionAction, restore: restoreVersionAction, branch: branchVersionAction, preview: previewVersionAction } =
    useVersions(boardId!);
  // Rendered as a second, read-only Canvas overlaying the live one (see
  // render below) rather than swapping which Canvas is mounted — the live
  // instance's WebSocket connection stays open the whole time, which is also
  // what makes announceRestore below always reach the real provider even if
  // a restore is triggered while a preview is open.
  const [previewingVersion, setPreviewingVersion] = useState<{ id: string; label: string | null; shapes: ShapeObj[] } | null>(null);
  // "Copy link to object" — consumed once per boardId so it doesn't re-fire
  // on an unrelated re-render, and cleared from the URL right after so a
  // later reload/share of the address bar doesn't repeat the pan.
  const consumedShapeIdRef = useRef<string | null>(null);

  useEffect(() => {
    setState({ status: "loading" });
    setTool("select");
    setHistory({ canUndo: false, canRedo: false });
    consumedShapeIdRef.current = null;
    getBoard(boardId!)
      .then((board) => setState({ status: "ready", board }))
      .catch((err) => setState({ status: "error", kind: err instanceof BoardAccessError ? err.status : 404 }));
  }, [boardId]);

  // A "Copy link to object" URL (?shapeId=...) pans to that shape once the
  // board — and so <Canvas>, which panToShape needs mounted — is ready. Kept
  // separate from the effect above, which fires before that's true.
  //
  // Being "ready" here only means the REST getBoard call succeeded — the
  // shape itself arrives separately, over the Yjs WebSocket sync, which a
  // fresh page load routinely loses the race with. panToShape reports
  // whether it found the shape; retry briefly rather than silently no-op on
  // a link that's otherwise completely valid.
  useEffect(() => {
    if (state.status !== "ready") return;
    const shapeId = searchParams.get("shapeId");
    if (!shapeId || consumedShapeIdRef.current === shapeId) return;

    let cancelled = false;
    let attempts = 0;
    function tryPan() {
      if (cancelled) return;
      if (canvasRef.current?.panToShape(shapeId!)) {
        consumedShapeIdRef.current = shapeId;
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            next.delete("shapeId");
            return next;
          },
          { replace: true },
        );
        return;
      }
      attempts += 1;
      if (attempts < 15) setTimeout(tryPan, 200);
    }
    tryPan();
    return () => {
      cancelled = true;
    };
  }, [state.status, searchParams, setSearchParams]);

  // Needed for @mention autocomplete wherever a comment gets composed — kept
  // separate from BoardHeader's own member fetch, which is scoped to the
  // Share panel's lazier open-on-demand lifecycle.
  useEffect(() => {
    listMembers(boardId!)
      .then(setMembers)
      .catch(() => {});
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

  // The context toolbar restyled some shapes — remember it per the tool(s)
  // that would create that shape type, so the next thing drawn with that
  // tool inherits it. `types` can span more than one bucket in a mixed
  // multi-selection (e.g. a rect + a sticky both recolored at once).
  const onToolStyleChange = useCallback((patch: Partial<ShapeObj>, types: Set<ShapeType>) => {
    setToolStyles((prev) => {
      let next = prev;
      for (const t of types) {
        const key = toolStylesKey(t);
        if (key) next = mergeIntoBucket(next, key, patch);
      }
      return next;
    });
  }, []);

  const handlePreviewVersion = useCallback(
    (version: { id: string; label: string | null }) => {
      previewVersionAction(version.id)
        .then((shapes) => setPreviewingVersion({ id: version.id, label: version.label, shapes }))
        .catch(() => {});
    },
    [previewVersionAction],
  );

  const handleRestoreVersion = useCallback(
    async (version: { id: string; label: string | null }) => {
      await restoreVersionAction(version.id);
      setPreviewingVersion(null);
      canvasRef.current?.announceRestore(version.label);
    },
    [restoreVersionAction],
  );

  const handleBranchVersion = useCallback(
    (version: { id: string }) => {
      branchVersionAction(version.id)
        .then((branch) => navigate(`/b/${branch.id}`))
        .catch(() => {});
    },
    [branchVersionAction, navigate],
  );

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
        threads={threads}
        canEdit={canEdit}
        onReply={reply}
        onResolve={resolve}
        onPanToThread={(threadId) => canvasRef.current?.panToThread(threadId)}
        versions={versions}
        previewingVersionId={previewingVersion?.id ?? null}
        onOpenVersions={refetchVersions}
        onSaveVersion={saveVersionAction}
        onPreviewVersion={handlePreviewVersion}
        onRestoreVersion={handleRestoreVersion}
        onBranchVersion={handleBranchVersion}
      />
      <div className="board-canvas-area">
        <Canvas
          ref={canvasRef}
          boardId={board.id}
          role={board.role}
          tool={tool}
          onEscape={() => setTool("select")}
          onHistoryChange={setHistory}
          onSelectionChange={setSelectionCount}
          me={me}
          toolStyles={toolStyles}
          onToolStyleChange={onToolStyleChange}
          clipboard={clipboard}
          onCopy={onCopy}
          threads={threads}
          members={members}
          onCreateThread={createThread}
          onDetachThreadAnchor={detachAnchor}
          onReplyToThread={reply}
          onResolveThread={resolve}
        />
        {canEdit && !previewingVersion && (
          <Toolbar
            tool={tool}
            onChange={setTool}
            canUndo={history.canUndo}
            canRedo={history.canRedo}
            onUndo={() => canvasRef.current?.undo()}
            onRedo={() => canvasRef.current?.redo()}
            stickyColor={toolStyles.sticky.color}
            onStickyColorChange={(color) => setToolStyles((s) => ({ ...s, sticky: { color } }))}
            penStyle={toolStyles.pen}
            onPenStyleChange={(patch) => setToolStyles((s) => ({ ...s, pen: { ...s.pen, ...patch } }))}
            onPickImages={(files) => canvasRef.current?.insertImageFiles(files)}
          />
        )}
        {previewingVersion && (
          <div className="board-canvas-preview-overlay">
            <div className="board-canvas-preview-banner">
              <span>Previewing {previewingVersion.label ? `"${previewingVersion.label}"` : "a previous version"}</span>
              <div className="board-canvas-preview-banner-actions">
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => {
                      if (!window.confirm(`Restore to ${previewingVersion.label ? `"${previewingVersion.label}"` : "this version"}? The current state is saved as a version first, so this can be undone.`)) {
                        return;
                      }
                      handleRestoreVersion(previewingVersion).catch(() => {});
                    }}
                  >
                    Restore this version
                  </button>
                )}
                <button type="button" onClick={() => setPreviewingVersion(null)}>
                  Exit preview
                </button>
              </div>
            </div>
            <Canvas
              // Forces a fresh mount (fresh Y.Doc) per distinct version —
              // switching Preview from one version straight to another,
              // without exiting first, must not leave stale shapes from the
              // previous preview merged into the new one.
              key={previewingVersion.id}
              boardId={board.id}
              role="viewer"
              tool="select"
              onEscape={() => {}}
              onHistoryChange={() => {}}
              onSelectionChange={() => {}}
              me={me}
              toolStyles={DEFAULT_TOOL_STYLES}
              onToolStyleChange={() => {}}
              clipboard={null}
              onCopy={() => {}}
              threads={[]}
              members={[]}
              onCreateThread={() => {}}
              onDetachThreadAnchor={() => {}}
              onReplyToThread={() => {}}
              onResolveThread={() => {}}
              previewShapes={previewingVersion.shapes}
            />
          </div>
        )}
      </div>
    </div>
  );
}
