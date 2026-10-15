import { useState, useTransition, type FormEvent } from "react";
import type { Settings } from "../shared/types.ts";
import { errorMessage } from "../shared/helpers.ts";
import { api } from "./api.ts";
import { Spinner } from "./ui.tsx";

type SettingsDialogProps = { settings: Settings; onSaved: (settings: Settings) => void; onClose: () => void };

export function SettingsDialog({ settings, onSaved, onClose }: SettingsDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startSaving(async () => {
      try {
        onSaved(
          await api.updateSettings({
            outputDir: String(form.get("outputDir")).trim(),
            squareCover: form.get("squareCover") === "on",
            musicbrainzContact: String(form.get("musicbrainzContact")).trim(),
          }),
        );
        onClose();
      } catch (cause) {
        setError(errorMessage(cause));
      }
    });
  }

  return (
    <dialog
      className="dialog"
      aria-labelledby="settings-title"
      ref={(dialog) => {
        if (dialog && !dialog.open) dialog.showModal();
      }}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit}>
        <h2 className="panel-title" id="settings-title">
          <span className="tape">Settings</span>
        </h2>
        <label className="field">
          <span className="field-label">Output folder</span>
          <input
            className="input"
            name="outputDir"
            defaultValue={settings.outputDir}
            autoComplete="off"
            spellCheck={false}
            required
          />
          <span className="field-help">Absolute path. Downloads and the library live here.</span>
        </label>
        <label className="check">
          <input type="checkbox" name="squareCover" defaultChecked={settings.squareCover} />
          Crop downloaded covers to a square
        </label>
        <label className="field">
          <span className="field-label">MusicBrainz contact</span>
          <input
            className="input"
            name="musicbrainzContact"
            defaultValue={settings.musicbrainzContact}
            placeholder="you@example.com or https://your-site"
            maxLength={200}
            autoComplete="off"
            spellCheck={false}
          />
          <span className="field-help">Optional. MusicBrainz asks apps to send a contact with each lookup.</span>
        </label>
        <p className="form-error" aria-live="polite">
          {error}
        </p>
        <div className="dialog-actions">
          <button type="button" className="button button-quiet" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button button-tape" disabled={saving}>
            {saving ? <Spinner label="Saving settings" /> : null}
            Save
          </button>
        </div>
      </form>
    </dialog>
  );
}
