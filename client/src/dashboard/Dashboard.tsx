import { useEffect, useState, type FormEvent } from "react";
import {
  createBoard,
  deleteBoard,
  inviteMember,
  listBoards,
  renameBoard,
  type BoardSummary,
} from "../api/boards";

interface DashboardProps {
  onOpenBoard: (board: BoardSummary) => void;
}

interface BoardCardProps {
  board: BoardSummary;
  onOpenBoard: (b: BoardSummary) => void;
  onRenamed: (boardId: string, title: string) => void;
  onDeleted: (boardId: string) => void;
}

function BoardCard({ board, onOpenBoard, onRenamed, onDeleted }: BoardCardProps) {
  const canEdit = board.role !== "viewer";
  const isOwner = board.role === "owner";

  const [sharing, setSharing] = useState(false);
  const [shareEmail, setShareEmail] = useState("");
  const [shareRole, setShareRole] = useState<"editor" | "viewer">("editor");
  const [shareStatus, setShareStatus] = useState<string | null>(null);

  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState(board.title);
  const [renameError, setRenameError] = useState<string | null>(null);

  async function handleShare(e: FormEvent) {
    e.preventDefault();
    setShareStatus(null);
    try {
      await inviteMember(board.id, shareEmail, shareRole);
      setShareStatus(`Shared with ${shareEmail}`);
      setShareEmail("");
    } catch (err) {
      setShareStatus(err instanceof Error ? err.message : "couldn't share");
    }
  }

  async function handleRename(e: FormEvent) {
    e.preventDefault();
    setRenameError(null);
    try {
      await renameBoard(board.id, titleDraft);
      onRenamed(board.id, titleDraft);
      setRenaming(false);
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : "couldn't rename");
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Delete "${board.title}"? This can't be undone.`)) return;
    try {
      await deleteBoard(board.id);
      onDeleted(board.id);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "couldn't delete");
    }
  }

  return (
    <div className="board-card">
      <button type="button" className="board-card-open" onClick={() => onOpenBoard(board)}>
        <div className="board-card-thumbnail">
          {board.thumbnail ? <img src={board.thumbnail} alt="" /> : <div className="board-card-blank" />}
        </div>
        <div className="board-card-title">{board.title}</div>
        {board.role !== "owner" && <div className="board-card-role">{board.role}</div>}
      </button>

      {canEdit && (
        <div className="board-card-actions">
          <button type="button" onClick={() => setRenaming((r) => !r)}>
            Rename
          </button>
          {isOwner && (
            <>
              <button type="button" onClick={() => setSharing((s) => !s)}>
                Share
              </button>
              <button type="button" className="board-card-delete" onClick={handleDelete}>
                Delete
              </button>
            </>
          )}
        </div>
      )}

      {renaming && (
        <form className="board-card-rename" onSubmit={handleRename}>
          <input
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            autoFocus
            required
          />
          <button type="submit">Save</button>
          {renameError && <span className="board-card-share-status">{renameError}</span>}
        </form>
      )}

      {sharing && (
        <form className="board-card-share" onSubmit={handleShare}>
          <input
            type="email"
            placeholder="Email"
            value={shareEmail}
            onChange={(e) => setShareEmail(e.target.value)}
            required
          />
          <select value={shareRole} onChange={(e) => setShareRole(e.target.value as "editor" | "viewer")}>
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
          </select>
          <button type="submit">Invite</button>
          {shareStatus && <span className="board-card-share-status">{shareStatus}</span>}
        </form>
      )}
    </div>
  );
}

type ViewFilter = "owned" | "shared" | "all";

const VIEW_LABELS: Record<ViewFilter, string> = {
  all: "All boards",
  owned: "Your boards",
  shared: "Shared with you",
};

const EMPTY_MESSAGES: Record<ViewFilter, string> = {
  all: "No boards yet — create one to get started.",
  owned: "No boards yet — create one to get started.",
  shared: "Nothing shared with you yet.",
};

export default function Dashboard({ onOpenBoard }: DashboardProps) {
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewFilter>("all");

  useEffect(() => {
    listBoards()
      .then(setBoards)
      .finally(() => setLoading(false));
  }, []);

  async function handleCreate() {
    const board = await createBoard("Untitled board");
    onOpenBoard(board);
  }

  function handleRenamed(boardId: string, title: string) {
    setBoards((prev) => prev.map((b) => (b.id === boardId ? { ...b, title } : b)));
  }

  function handleDeleted(boardId: string) {
    setBoards((prev) => prev.filter((b) => b.id !== boardId));
  }

  const visible = boards.filter((b) => {
    if (view === "owned") return b.role === "owner";
    if (view === "shared") return b.role !== "owner";
    return true;
  });

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>Whiteboard</h1>
        <button type="button" onClick={handleCreate}>
          + New board
        </button>
      </header>

      <div className="dashboard-view-select">
        <label htmlFor="board-view">Showing</label>
        <select id="board-view" value={view} onChange={(e) => setView(e.target.value as ViewFilter)}>
          {(Object.keys(VIEW_LABELS) as ViewFilter[]).map((key) => (
            <option key={key} value={key}>
              {VIEW_LABELS[key]}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <p>Loading...</p>
      ) : visible.length === 0 ? (
        <p className="dashboard-empty">{EMPTY_MESSAGES[view]}</p>
      ) : (
        // ponytail: fixed 3-per-row for now. Zoom-responsive column count
        // (more columns as you zoom out, fewer as you zoom in) is a planned
        // follow-up, not implemented yet.
        <div className="board-grid">
          {visible.map((board) => (
            <BoardCard
              key={board.id}
              board={board}
              onOpenBoard={onOpenBoard}
              onRenamed={handleRenamed}
              onDeleted={handleDeleted}
            />
          ))}
        </div>
      )}
    </div>
  );
}
