import { useState, useTransition } from "react";
import type { RenameItem, Track } from "../shared/types.ts";
import { errorMessage } from "../shared/helpers.ts";
import { api } from "./api.ts";
import { fileName, Spinner } from "./ui.tsx";

const DEFAULT_PATTERN = "{album} - {title}";
const TOKENS = ["{album}", "{title}", "{artist}", "{albumartist}", "{track}", "{year}"];

type RenamePanelProps = { tracks: Track[]; onRenamed: (paths: string[]) => void };

export function RenamePanel({ tracks, onRenamed }: RenamePanelProps) {
  const [pattern, setPattern] = useState(DEFAULT_PATTERN);
  const [preview, setPreview] = useState<{ pattern: string; items: RenameItem[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewing, startPreview] = useTransition();
  const [renaming, startRename] = useTransition();
  const busy = previewing || renaming;
  const paths = tracks.map((track) => track.path);
  const isCurrent = preview?.pattern === pattern;
  const problems = preview?.items.filter((item) => item.problem).length ?? 0;
  const changes = preview?.items.filter((item) => item.newPath !== item.path).length ?? 0;
  const canApply = isCurrent && problems === 0 && changes > 0;

  function runPreview() {
    startPreview(async () => {
      try {
        setPreview({ pattern, items: await api.previewRename({ paths, pattern }) });
        setError(null);
      } catch (cause) {
        setError(errorMessage(cause));
      }
    });
  }

  function runApply() {
    startRename(async () => {
      try {
        const items = await api.applyRename({ paths, pattern });
        onRenamed(items.map((item) => item.newPath));
      } catch (cause) {
        setError(errorMessage(cause));
      }
    });
  }

  return (
    <details className="tool">
      <summary className="tool-summary">Rename files</summary>
      <div className="tool-body">
        <label className="field">
          <span className="field-label">Pattern</span>
          <input
            className="input"
            value={pattern}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setPattern(event.target.value)}
          />
        </label>
        <div className="token-row" aria-label="Insert a token">
          {TOKENS.map((token) => (
            <button
              key={token}
              type="button"
              className="token"
              onClick={() => setPattern((current) => current + token)}
            >
              {token}
            </button>
          ))}
        </div>
        <div className="form-actions">
          <button type="button" className="button button-quiet" onClick={runPreview} disabled={busy || !pattern.trim()}>
            {previewing ? <Spinner label="Building preview" /> : null}
            Preview
          </button>
          <button type="button" className="button button-tape" onClick={runApply} disabled={busy || !canApply}>
            {renaming ? <Spinner label="Renaming" /> : null}
            Rename {changes > 0 ? changes : ""}
          </button>
        </div>
        <p className="form-error" aria-live="polite">
          {error ?? (isCurrent && problems > 0 ? `Fix ${problems} name ${problems === 1 ? "conflict" : "conflicts"} first.` : null)}
        </p>
        {preview && isCurrent ? (
          <div className="table-wrap">
            <table className="rename-table">
              <thead>
                <tr>
                  <th scope="col">Current name</th>
                  <th scope="col">New name</th>
                </tr>
              </thead>
              <tbody>
                {preview.items.map((item) => (
                  <tr key={item.path} data-problem={item.problem ? "" : undefined}>
                    <td>{fileName(item.path)}</td>
                    <td>
                      {item.newPath === item.path ? <span className="muted">unchanged</span> : fileName(item.newPath)}
                      {item.problem ? <span className="row-problem">{item.problem}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </details>
  );
}
