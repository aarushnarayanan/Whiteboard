import { useEffect, useState, type FormEvent } from "react";
import {
  deleteBoard,
  duplicateBoard,
  inviteMember,
  listMembers,
  removeMember,
  renameBoard,
  setTag,
  type BoardMember,
  type BoardSummary,
} from "../api/boards";
import { createTag, listTags, type Tag } from "../api/tags";
import { tagColor } from "../tagColor";

interface BoardHeaderProps {
  board: BoardSummary;
  onBack: () => void;
  onRenamed: (title: string) => void;
  onDeleted: () => void;
  onDuplicated: (board: BoardSummary) => void;
  onTagged: (tagId: string | null) => void;
}

function BackIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 12l5 5L20 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CommentIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 5h16v11H10l-4 4v-4H4z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

function HistoryIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 4v6h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.5 13a8 8 0 108-9.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M12 8v4l3 2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PresentIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10 8.3l6 3.7-6 3.7z" fill="currentColor" />
    </svg>
  );
}

function KebabIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="5" cy="12" r="1.7" fill="currentColor" />
      <circle cx="12" cy="12" r="1.7" fill="currentColor" />
      <circle cx="19" cy="12" r="1.7" fill="currentColor" />
    </svg>
  );
}

export default function BoardHeader({ board, onBack, onRenamed, onDeleted, onDuplicated, onTagged }: BoardHeaderProps) {
  const isOwner = board.role === "owner";

  const [titleMenuOpen, setTitleMenuOpen] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState(board.title);

  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);

  const [sharing, setSharing] = useState(false);
  const [shareEmail, setShareEmail] = useState("");
  const [shareRole, setShareRole] = useState<"editor" | "viewer">("editor");
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const [members, setMembers] = useState<BoardMember[] | null>(null);
  const [membersError, setMembersError] = useState<string | null>(null);

  const [tagging, setTagging] = useState(false);
  const [tags, setTags] = useState<Tag[]>([]);
  const [newTagName, setNewTagName] = useState("");
  const [tagError, setTagError] = useState<string | null>(null);

  useEffect(() => {
    if (!sharing) return;
    setMembersError(null);
    listMembers(board.id)
      .then(setMembers)
      .catch((err) => setMembersError(err instanceof Error ? err.message : "couldn't load members"));
  }, [sharing, board.id]);

  useEffect(() => {
    if (!tagging) return;
    setTagError(null);
    listTags()
      .then(setTags)
      .catch((err) => setTagError(err instanceof Error ? err.message : "couldn't load tags"));
  }, [tagging]);

  const currentTag = tags.find((t) => t.id === board.tagId);

  async function handleAssignTag(tagId: string | null) {
    try {
      await setTag(board.id, tagId);
      onTagged(tagId);
      setTagging(false);
    } catch (err) {
      setTagError(err instanceof Error ? err.message : "couldn't set tag");
    }
  }

  async function handleCreateTag(e: FormEvent) {
    e.preventDefault();
    const name = newTagName.trim();
    if (!name) return;
    setTagError(null);
    try {
      const tag = await createTag(name);
      setTags((prev) => [...prev, tag]);
      setNewTagName("");
      await handleAssignTag(tag.id);
    } catch (err) {
      setTagError(err instanceof Error ? err.message : "couldn't create tag");
    }
  }

  async function handleRemoveMember(userId: string) {
    try {
      await removeMember(board.id, userId);
      setMembers((prev) => prev?.filter((m) => m.userId !== userId) ?? null);
      setMembersError(null);
    } catch (err) {
      setMembersError(err instanceof Error ? err.message : "couldn't remove member");
    }
  }

  async function saveRename() {
    const title = titleDraft.trim();
    setRenaming(false);
    if (!title || title === board.title) return;
    try {
      await renameBoard(board.id, title);
      onRenamed(title);
    } catch {
      setTitleDraft(board.title);
    }
  }

  async function handleShare(e: FormEvent) {
    e.preventDefault();
    setShareStatus(null);
    try {
      await inviteMember(board.id, shareEmail, shareRole);
      setShareStatus(`Shared with ${shareEmail}`);
      setShareEmail("");
      listMembers(board.id)
        .then(setMembers)
        .catch(() => {});
    } catch (err) {
      setShareStatus(err instanceof Error ? err.message : "couldn't share");
    }
  }

  async function handleDelete() {
    setHeaderMenuOpen(false);
    if (!window.confirm(`Delete "${board.title}"? This can't be undone.`)) return;
    try {
      await deleteBoard(board.id);
      onDeleted();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "couldn't delete");
    }
  }

  async function handleDuplicate() {
    setTitleMenuOpen(false);
    setHeaderMenuOpen(false);
    setDuplicating(true);
    try {
      const duplicate = await duplicateBoard(board.id);
      onDuplicated(duplicate);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "couldn't duplicate");
    } finally {
      setDuplicating(false);
    }
  }

  return (
    <header className="board-header">
      <button type="button" className="board-header-icon-btn" onClick={onBack} aria-label="Back to boards">
        <BackIcon />
      </button>

      <div className="board-header-logomark">
        <span />
        <span />
      </div>

      <div className="board-header-title-wrap">
        {renaming ? (
          <input
            className="board-header-title-input"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={saveRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") {
                setTitleDraft(board.title);
                setRenaming(false);
              }
            }}
            autoFocus
          />
        ) : (
          <>
            <span className="board-header-title">{board.title}</span>
            <button
              type="button"
              className="board-header-icon-btn board-header-icon-btn-sm"
              onClick={() => setTitleMenuOpen((m) => !m)}
              aria-label="Board title menu"
            >
              <ChevronDownIcon />
            </button>
          </>
        )}

        {titleMenuOpen && (
          <>
            <div className="board-header-menu-backdrop" onClick={() => setTitleMenuOpen(false)} />
            <div className="board-header-menu">
              <button
                type="button"
                onClick={() => {
                  setTitleDraft(board.title);
                  setRenaming(true);
                  setTitleMenuOpen(false);
                }}
              >
                Rename
              </button>
              <button type="button" disabled={duplicating} onClick={handleDuplicate}>
                {duplicating ? "Duplicating…" : "Duplicate board"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setTitleMenuOpen(false);
                  setTagging(true);
                }}
              >
                {currentTag ? `Tag: ${currentTag.name}` : "Tag board"}
              </button>
              <div className="board-header-menu-divider" />
              <button type="button" disabled title="Not built yet">
                Export as PNG
              </button>
              <button type="button" disabled title="Not built yet">
                Export as PDF
              </button>
            </div>
          </>
        )}

        {tagging && (
          <>
            <div className="board-header-menu-backdrop" onClick={() => setTagging(false)} />
            <div className="board-header-tag-popover">
              <span className="board-header-tag-popover-label">Tag this board</span>
              {tagError && <span className="board-header-share-status">{tagError}</span>}
              {tags.length > 0 && (
                <div className="board-header-tag-list">
                  {tags.map((tag) => (
                    <button
                      type="button"
                      key={tag.id}
                      className={`board-header-tag-option ${tag.id === board.tagId ? "board-header-tag-option-active" : ""}`}
                      onClick={() => handleAssignTag(tag.id)}
                    >
                      <span className="dash-tag-dot" style={{ background: tagColor(tag.id) }} />
                      {tag.name}
                    </button>
                  ))}
                </div>
              )}
              {board.tagId && (
                <button type="button" className="board-header-tag-remove" onClick={() => handleAssignTag(null)}>
                  Remove tag
                </button>
              )}
              <form className="board-header-tag-form" onSubmit={handleCreateTag}>
                <input
                  type="text"
                  placeholder="New tag name"
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  maxLength={40}
                />
                <button type="submit">Create</button>
              </form>
            </div>
          </>
        )}
      </div>

      <span className="board-header-dot">·</span>
      <span className="board-header-saved">
        <CheckIcon /> Saved
      </span>

      <div className="board-header-spacer" />

      <button type="button" className="board-header-icon-btn" disabled title="Not built yet">
        <CommentIcon />
      </button>
      <button type="button" className="board-header-icon-btn" disabled title="Not built yet">
        <HistoryIcon />
      </button>
      <button type="button" className="board-header-icon-btn" disabled title="Not built yet">
        <PresentIcon />
      </button>

      <div className="board-header-divider" />

      <div className="board-header-share-wrap">
        <button
          type="button"
          className="board-header-share"
          disabled={!isOwner}
          title={isOwner ? undefined : "Only the board owner can share"}
          onClick={() => setSharing((s) => !s)}
        >
          Share
        </button>
        {sharing && (
          <>
            <div className="board-header-menu-backdrop" onClick={() => setSharing(false)} />
            <form className="board-header-share-form" onSubmit={handleShare}>
              <label className="board-header-share-label">
                Invite by email
                <input
                  type="email"
                  placeholder="you@company.com"
                  value={shareEmail}
                  onChange={(e) => setShareEmail(e.target.value)}
                  required
                />
              </label>
              <div className="board-header-share-row">
                <select value={shareRole} onChange={(e) => setShareRole(e.target.value as "editor" | "viewer")}>
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
                <button type="submit">Invite</button>
              </div>
              {shareStatus && <span className="board-header-share-status">{shareStatus}</span>}

              <div className="board-header-share-members">
                <span className="board-header-share-members-title">People with access</span>
                {membersError && <span className="board-header-share-status">{membersError}</span>}
                {members === null && !membersError ? (
                  <span className="board-header-share-members-empty">Loading…</span>
                ) : (
                  members?.map((member) => (
                    <div key={member.userId} className="board-header-share-member">
                      <span className="board-header-share-member-info">
                        <span className="board-header-share-member-name">{member.name}</span>
                        <span className="board-header-share-member-email">{member.email}</span>
                      </span>
                      <span className="board-header-share-member-role">{member.role}</span>
                      {member.role !== "owner" && (
                        <button
                          type="button"
                          className="board-header-share-member-remove"
                          aria-label={`Remove ${member.email}`}
                          onClick={() => handleRemoveMember(member.userId)}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </form>
          </>
        )}
      </div>

      <div className="board-header-menu-wrap">
        <button
          type="button"
          className="board-header-icon-btn"
          onClick={() => setHeaderMenuOpen((m) => !m)}
          aria-label="Board options"
        >
          <KebabIcon />
        </button>
        {headerMenuOpen && (
          <>
            <div className="board-header-menu-backdrop" onClick={() => setHeaderMenuOpen(false)} />
            <div className="board-header-menu board-header-menu-right">
              <button type="button" disabled title="Not built yet">
                Board settings
              </button>
              <button type="button" disabled={duplicating} onClick={handleDuplicate}>
                {duplicating ? "Duplicating…" : "Duplicate board"}
              </button>
              <button type="button" disabled title="Not built yet">
                Export
              </button>
              <div className="board-header-menu-divider" />
              <button
                type="button"
                className="board-header-menu-danger"
                disabled={!isOwner}
                title={isOwner ? undefined : "Only the board owner can delete"}
                onClick={handleDelete}
              >
                Delete board
              </button>
            </div>
          </>
        )}
      </div>
    </header>
  );
}
