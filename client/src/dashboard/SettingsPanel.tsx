import { useState, type FormEvent } from "react";
import { changePassword, deleteAccount, updateName, type Me } from "../api/auth";

interface SettingsPanelProps {
  me: Me;
  onMeUpdated: (me: Me) => void;
  onAccountDeleted: () => void;
}

export default function SettingsPanel({ me, onMeUpdated, onAccountDeleted }: SettingsPanelProps) {
  const [nameDraft, setNameDraft] = useState(me.name);
  const [nameStatus, setNameStatus] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordStatus, setPasswordStatus] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const [deleting, setDeleting] = useState(false);

  async function handleSaveName(e: FormEvent) {
    e.preventDefault();
    setNameStatus(null);
    const name = nameDraft.trim();
    if (!name || name === me.name) return;
    try {
      await updateName(name);
      onMeUpdated({ ...me, name });
      setNameStatus("Saved.");
    } catch (err) {
      setNameStatus(err instanceof Error ? err.message : "couldn't save");
    }
  }

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault();
    setPasswordStatus(null);
    setPasswordError(null);
    if (newPassword !== confirmPassword) {
      setPasswordError("New passwords don't match.");
      return;
    }
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordStatus("Password updated.");
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : "couldn't change password");
    }
  }

  async function handleDeleteAccount() {
    if (!window.confirm("Delete your account? This can't be undone.")) return;
    setDeleting(true);
    try {
      await deleteAccount();
      onAccountDeleted();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "couldn't delete account");
      setDeleting(false);
    }
  }

  return (
    <div className="settings-panel">
      <section className="settings-section">
        <h2>Profile</h2>
        <form className="settings-form" onSubmit={handleSaveName}>
          <label className="settings-field">
            Name
            <input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} required />
          </label>
          <label className="settings-field">
            Email
            <input value={me.email} disabled />
          </label>
          <div className="settings-form-row">
            <button type="submit" className="settings-button-primary">
              Save
            </button>
            {nameStatus && <span className="settings-status">{nameStatus}</span>}
          </div>
        </form>
      </section>

      <section className="settings-section">
        <h2>Password</h2>
        {me.hasPassword ? (
          <form className="settings-form" onSubmit={handleChangePassword}>
            <label className="settings-field">
              Current password
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
            </label>
            <label className="settings-field">
              New password
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={8}
                required
              />
            </label>
            <label className="settings-field">
              Confirm new password
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                minLength={8}
                required
              />
            </label>
            <div className="settings-form-row">
              <button type="submit" className="settings-button-primary">
                Change password
              </button>
              {passwordStatus && <span className="settings-status">{passwordStatus}</span>}
              {passwordError && <span className="settings-status settings-status-error">{passwordError}</span>}
            </div>
          </form>
        ) : (
          <p className="settings-muted">Your account signs in with Google — there's no password to change.</p>
        )}
      </section>

      <section className="settings-section settings-section-danger">
        <h2>Danger zone</h2>
        <p className="settings-muted">
          Permanently delete your account and every board you own. Boards shared with you by others are unaffected.
        </p>
        <button type="button" className="settings-button-danger" disabled={deleting} onClick={handleDeleteAccount}>
          {deleting ? "Deleting…" : "Delete account"}
        </button>
      </section>
    </div>
  );
}
