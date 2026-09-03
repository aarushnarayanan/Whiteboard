import { useState, type FormEvent } from "react";
import { deleteBoard, inviteMember, renameBoard, setStarred, type BoardSummary } from "../api/boards";

interface BoardCardProps {
  board: BoardSummary;
  layout?: "grid" | "list";
  onOpenBoard: (b: BoardSummary) => void;
  onRenamed: (boardId: string, title: string) => void;
  onDeleted: (boardId: string) => void;
  onStarToggled: (boardId: string, starred: boolean) => void;
}

function KebabIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="5" cy="12" r="1.6" fill="currentColor" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
      <circle cx="19" cy="12" r="1.6" fill="currentColor" />
    </svg>
  );
}

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <path d="M12 2.5l2.9 6.4 6.9.7-5.2 4.8 1.5 6.9L12 17.7l-6.1 3.6 1.5-6.9-5.2-4.8 6.9-.7z" strokeLinejoin="round" />
    </svg>
  );
}

export function hashVariant(id: string): 1 | 2 | 3 | 4 | 5 {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ((h % 5) + 1) as 1 | 2 | 3 | 4 | 5;
}

export function ThumbArt({ variant }: { variant: 1 | 2 | 3 | 4 | 5 }) {
  switch (variant) {
    case 1:
      return (
        <div className="board-thumb board-thumb-1">
          <div className="board-thumb-1-note-a" />
          <div className="board-thumb-1-note-b" />
          <div className="board-thumb-1-line" />
        </div>
      );
    case 2:
      return (
        <div className="board-thumb board-thumb-2">
          <div className="board-thumb-2-sq board-thumb-2-sq-a" />
          <div className="board-thumb-2-sq board-thumb-2-sq-b" />
          <div className="board-thumb-2-sq board-thumb-2-sq-c" />
          <div className="board-thumb-2-bar board-thumb-2-bar-a" />
          <div className="board-thumb-2-bar board-thumb-2-bar-b" />
        </div>
      );
    case 3:
      return (
        <div className="board-thumb board-thumb-3">
          <div className="board-thumb-3-note board-thumb-3-note-a" />
          <div className="board-thumb-3-note board-thumb-3-note-b" />
          <div className="board-thumb-3-note board-thumb-3-note-c" />
        </div>
      );
    case 4:
      return (
        <div className="board-thumb board-thumb-4">
          <div className="board-thumb-4-box board-thumb-4-box-a" />
          <div className="board-thumb-4-box board-thumb-4-box-b" />
          <div className="board-thumb-4-line" />
          <div className="board-thumb-4-arrow" />
        </div>
      );
    default:
      return (
        <div className="board-thumb board-thumb-5">
          <div className="board-thumb-5-bar board-thumb-5-title" />
          <div className="board-thumb-5-rule board-thumb-5-rule-a" />
          <div className="board-thumb-5-cell board-thumb-5-cell-a" />
          <div className="board-thumb-5-cell board-thumb-5-cell-b" />
          <div className="board-thumb-5-rule board-thumb-5-rule-b" />
          <div className="board-thumb-5-cell board-thumb-5-cell-c" />
          <div className="board-thumb-5-cell board-thumb-5-cell-d" />
        </div>
      );
  }
}

export default function BoardCard({
  board,
  layout = "grid",
  onOpenBoard,
  onRenamed,
  onDeleted,
  onStarToggled,
}: BoardCardProps) {
  const canEdit = board.role !== "viewer";
  const isOwner = board.role === "owner";

  const [menuOpen, setMenuOpen] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareEmail, setShareEmail] = useState("");
  const [shareRole, setShareRole] = useState<"editor" | "viewer">("editor");
  const [shareStatus, setShareStatus] = useState<string | null>(null);

  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState(board.title);
  const [renameError, setRenameError] = useState<string | null>(null);

  function handleCopyLink() {
    navigator.clipboard.writeText(`${window.location.origin}/b/${board.id}`);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 1200);
  }

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

  async function handleToggleStar() {
    const next = !board.starred;
    onStarToggled(board.id, next);
    try {
      await setStarred(board.id, next);
    } catch {
      onStarToggled(board.id, !next);
    }
  }

  async function handleDelete() {
    setMenuOpen(false);
    if (!window.confirm(`Delete "${board.title}"? This can't be undone.`)) return;
    try {
      await deleteBoard(board.id);
      onDeleted(board.id);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "couldn't delete");
    }
  }

  const thumbContent = board.thumbnail ? (
    <img src={board.thumbnail} alt="" />
  ) : (
    <ThumbArt variant={hashVariant(board.id)} />
  );

  const editedLabel = `Edited ${new Date(board.updatedAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })}`;

  const starButton = (
    <button
      type="button"
      className="board-card-icon-btn"
      onClick={handleToggleStar}
      aria-label={board.starred ? "Unstar board" : "Star board"}
    >
      <StarIcon filled={board.starred} />
    </button>
  );

  const optionsMenu = canEdit && (
    <div className="board-card-menu-wrap">
      <button
        type="button"
        className="board-card-icon-btn"
        onClick={() => setMenuOpen((m) => !m)}
        aria-label="Board options"
      >
        <KebabIcon />
      </button>
      {menuOpen && (
        <>
          <div className="board-card-menu-backdrop" onClick={() => setMenuOpen(false)} />
          <div className="board-card-menu">
            <button
              type="button"
              onClick={() => {
                setRenaming(true);
                setMenuOpen(false);
              }}
            >
              Rename
            </button>
            <button type="button" onClick={handleCopyLink}>
              {linkCopied ? "Copied!" : "Copy link"}
            </button>
            {isOwner && (
              <button
                type="button"
                onClick={() => {
                  setSharing((s) => !s);
                  setMenuOpen(false);
                }}
              >
                Share
              </button>
            )}
            {isOwner && (
              <>
                <div className="board-card-menu-divider" />
                <button type="button" className="board-card-menu-danger" onClick={handleDelete}>
                  Delete
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );

  return (
    <div className={`board-card ${layout === "list" ? "board-card-list" : ""}`}>
      {layout === "list" ? (
        <>
          <button type="button" className="board-card-list-thumb" onClick={() => onOpenBoard(board)}>
            {thumbContent}
          </button>
          <button type="button" className="board-card-list-title" onClick={() => onOpenBoard(board)}>
            {board.title}
          </button>
          <span className="board-card-list-meta">{editedLabel}</span>
          {board.role !== "owner" && (
            <span className="board-card-role-pill board-card-role-pill-inline">{board.role}</span>
          )}
          <div className="board-card-list-actions">
            {starButton}
            {optionsMenu}
          </div>
        </>
      ) : (
        <>
          <div className="board-card-thumb-wrap">
            <button type="button" className="board-card-open-thumb" onClick={() => onOpenBoard(board)}>
              {thumbContent}
            </button>

            {board.role !== "owner" && <span className="board-card-role-pill">{board.role}</span>}

            <div className="board-card-thumb-actions">
              {starButton}
              {optionsMenu}
            </div>
          </div>

          <button type="button" className="board-card-info" onClick={() => onOpenBoard(board)}>
            <div className="board-card-title">{board.title}</div>
            <div className="board-card-meta">{editedLabel}</div>
          </button>
        </>
      )}

      {renaming && (
        <form className="board-card-rename" onSubmit={handleRename}>
          <input value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)} autoFocus required />
          <button type="submit">Save</button>
          <button type="button" onClick={() => setRenaming(false)}>
            Cancel
          </button>
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
