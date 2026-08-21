import { useEffect, useState, type FormEvent } from "react";
import { createBoard, inviteMember, listBoards, type BoardSummary } from "../api/boards";

interface DashboardProps {
  onOpenBoard: (board: BoardSummary) => void;
}

function BoardCard({ board, onOpenBoard }: { board: BoardSummary; onOpenBoard: (b: BoardSummary) => void }) {
  const [sharing, setSharing] = useState(false);
  const [shareEmail, setShareEmail] = useState("");
  const [shareRole, setShareRole] = useState<"editor" | "viewer">("editor");
  const [shareStatus, setShareStatus] = useState<string | null>(null);

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

  return (
    <div className="board-card">
      <button type="button" className="board-card-open" onClick={() => onOpenBoard(board)}>
        <div className="board-card-thumbnail">
          {board.thumbnail ? <img src={board.thumbnail} alt="" /> : <div className="board-card-blank" />}
        </div>
        <div className="board-card-title">{board.title}</div>
        {board.role !== "owner" && <div className="board-card-role">{board.role}</div>}
      </button>
      {board.role === "owner" && (
        <div className="board-card-share">
          <button type="button" onClick={() => setSharing((s) => !s)}>
            Share
          </button>
          {sharing && (
            <form onSubmit={handleShare}>
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
            <BoardCard key={board.id} board={board} onOpenBoard={onOpenBoard} />
          ))}
        </div>
      )}
    </div>
  );
}
