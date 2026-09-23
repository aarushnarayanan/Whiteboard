import { useState, type FormEvent } from "react";
import type { BoardVersion } from "../api/versions";

interface VersionHistoryPanelProps {
  versions: BoardVersion[];
  canEdit: boolean;
  previewingVersionId: string | null;
  onSave: (label: string) => Promise<void>;
  onPreview: (version: BoardVersion) => void;
  onRestore: (version: BoardVersion) => Promise<void>;
  onBranch: (version: BoardVersion) => void;
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function VersionHistoryPanel({
  versions,
  canEdit,
  previewingVersionId,
  onSave,
  onPreview,
  onRestore,
  onBranch,
}: VersionHistoryPanelProps) {
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;
    setSaving(true);
    setError(null);
    onSave(label.trim())
      .then(() => setLabel(""))
      .catch(() => setError("Couldn't save that version — try again."))
      .finally(() => setSaving(false));
  }

  function handleRestore(version: BoardVersion) {
    if (!window.confirm(`Restore to ${version.label ? `"${version.label}"` : "this version"}? The current state is saved as a version first, so this can be undone.`)) {
      return;
    }
    setRestoringId(version.id);
    setError(null);
    onRestore(version)
      .catch(() => setError("Couldn't restore that version — try again."))
      .finally(() => setRestoringId(null));
  }

  return (
    <>
      {canEdit && (
        <form className="version-history-save-form" onSubmit={handleSave}>
          <input
            type="text"
            placeholder="Name this version…"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={80}
          />
          <button type="submit" disabled={saving || !label.trim()}>
            {saving ? "Saving…" : "Save"}
          </button>
        </form>
      )}
      {error && <p className="version-history-error">{error}</p>}
      {versions.length === 0 && <p className="board-header-comments-empty">No versions yet.</p>}
      <div className="version-history-list">
        {versions.map((version) => (
          <div key={version.id} className={`version-history-row${previewingVersionId === version.id ? " version-history-row-active" : ""}`}>
            <div className="version-history-row-info">
              <span className="version-history-row-label">{version.label ?? "Auto-saved version"}</span>
              <span className="version-history-row-meta">
                {relativeTime(version.createdAt)}
                {version.contributors.length > 0 && ` · ${version.contributors.map((c) => c.name).join(", ")}`}
              </span>
            </div>
            <div className="version-history-row-actions">
              <button type="button" onClick={() => onPreview(version)}>
                Preview
              </button>
              {canEdit && (
                <>
                  <button type="button" onClick={() => handleRestore(version)} disabled={restoringId === version.id}>
                    {restoringId === version.id ? "Restoring…" : "Restore"}
                  </button>
                </>
              )}
              <button type="button" onClick={() => onBranch(version)}>
                Branch
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
