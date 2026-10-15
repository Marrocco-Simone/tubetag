import { useEffect, useState, useTransition, type ChangeEvent, type FormEvent } from "react";
import { errorMessage } from "../shared/helpers.ts";
import type { CoverSource, TagValues, Track, WriteResult, WriteTagsRequest } from "../shared/types.ts";
import { api } from "./api.ts";
import { MusicBrainzPanel } from "./MusicBrainzPanel.tsx";
import { RenamePanel } from "./RenamePanel.tsx";
import { CoverThumb, fileName, sharedValue, Spinner, type EditableField, type SaveTags } from "./ui.tsx";

type PendingCover = { kind: "upload"; file: File; preview: string } | { kind: "url"; url: string } | { kind: "file"; track: Track };
type Outcome = { saved: number; failures: WriteResult[] } | { error: string };

const FIELDS: { field: EditableField; label: string }[] = [
  { field: "title", label: "Title" },
  { field: "artist", label: "Artist" },
  { field: "album", label: "Album" },
  { field: "albumartist", label: "Album artist" },
  { field: "year", label: "Year" },
  { field: "genre", label: "Genre" },
];

function toCoverSource(cover: PendingCover): CoverSource {
  if (cover.kind === "upload") return { kind: "upload" };
  if (cover.kind === "url") return { kind: "url", url: cover.url, whenMissing: "fail" };
  return { kind: "file", path: cover.track.path };
}

type TagFormProps = { tracks: Track[]; anchorPath: string | null; squareCover: boolean; onSave: SaveTags };

function TagForm({ tracks, anchorPath, squareCover, onSave }: TagFormProps) {
  const [drafts, setDrafts] = useState<Partial<Record<EditableField, string>>>({});
  const [numberTracks, setNumberTracks] = useState(false);
  const [cover, setCover] = useState<PendingCover | null>(null);
  const [coverUrlDraft, setCoverUrlDraft] = useState("");
  const [cropSquare, setCropSquare] = useState(squareCover);
  const [saving, startSaving] = useTransition();
  const single = tracks.length === 1;
  const fields = single ? FIELDS : FIELDS.filter(({ field }) => field !== "title");
  const previewTrack = tracks.find((track) => track.path === anchorPath) ?? tracks[0];

  const changedTags: TagValues = {};
  for (const { field } of fields) {
    const draft = drafts[field];
    if (draft !== undefined && draft !== (sharedValue(tracks, field) ?? "")) changedTags[field] = draft;
  }
  const hasChanges = Object.keys(changedTags).length > 0 || numberTracks || cover !== null;

  const uploadPreview = cover?.kind === "upload" ? cover.preview : null;

  useEffect(() => {
    if (!uploadPreview) return;
    return () => URL.revokeObjectURL(uploadPreview);
  }, [uploadPreview]);

  function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) setCover({ kind: "upload", file, preview: URL.createObjectURL(file) });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const edits = tracks.map((track, index) => ({
      path: track.path,
      tags: numberTracks ? { ...changedTags, track: `${index + 1}/${tracks.length}` } : changedTags,
    }));
    const request: WriteTagsRequest = { edits, cover: cover ? toCoverSource(cover) : null, cropSquare };
    startSaving(() => onSave(request, cover?.kind === "upload" ? cover.file : null));
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="fields">
        {fields.map(({ field, label }) => {
          const shared = sharedValue(tracks, field);
          return (
            <label className={`field field-${field}`} key={field}>
              <span className="field-label">{label}</span>
              <input
                className="input"
                name={field}
                inputMode={field === "year" ? "numeric" : undefined}
                autoComplete="off"
                value={drafts[field] ?? shared ?? ""}
                placeholder={shared === null ? "(multiple values)" : ""}
                onChange={(event) => setDrafts((current) => ({ ...current, [field]: event.target.value }))}
              />
            </label>
          );
        })}
      </div>
      {single ? null : (
        <button
          type="button"
          className="button button-toggle"
          aria-pressed={numberTracks}
          onClick={() => setNumberTracks((current) => !current)}
        >
          Number tracks 1–{tracks.length} in list order
        </button>
      )}

      <fieldset className="cover-block">
        <legend className="field-label">Cover</legend>
        <div className="cover-preview">
          {cover === null && previewTrack ? <CoverThumb track={previewTrack} size={148} /> : null}
          {cover?.kind === "file" ? <CoverThumb track={cover.track} size={148} /> : null}
          {cover?.kind === "upload" || cover?.kind === "url" ? (
            <img className="cover" src={cover.kind === "upload" ? cover.preview : cover.url} width={148} height={148} alt="New cover" />
          ) : null}
          {cover ? <span className="cover-badge">New</span> : null}
        </div>
        <div className="cover-actions">
          <label className="button button-quiet file-button">
            Upload image…
            <input type="file" accept="image/*" className="visually-hidden" onChange={handleUpload} />
          </label>
          <div className="inline-input">
            <input
              className="input"
              type="url"
              aria-label="Cover image URL"
              placeholder="https://…/cover.jpg"
              value={coverUrlDraft}
              onChange={(event) => setCoverUrlDraft(event.target.value)}
            />
            <button
              type="button"
              className="button button-quiet"
              disabled={!URL.canParse(coverUrlDraft)}
              onClick={() => setCover({ kind: "url", url: coverUrlDraft })}
            >
              Use URL
            </button>
          </div>
          {previewTrack?.hasCover && cover === null ? (
            <button
              type="button"
              className="button button-quiet"
              onClick={() => setCover({ kind: "file", track: previewTrack })}
            >
              {single ? "Re-encode this cover" : `Use this cover for all ${tracks.length}`}
            </button>
          ) : null}
          {cover ? (
            <button type="button" className="button button-quiet" onClick={() => setCover(null)}>
              Discard new cover
            </button>
          ) : null}
          <label className="check">
            <input type="checkbox" checked={cropSquare} onChange={(event) => setCropSquare(event.target.checked)} />
            Crop new cover to a square
          </label>
        </div>
      </fieldset>

      <div className="form-actions">
        <button type="submit" className="button button-tape" disabled={!hasChanges || saving}>
          {saving ? <Spinner label="Writing tags" /> : null}
          Write {tracks.length === 1 ? "file" : `${tracks.length} files`}
        </button>
      </div>
    </form>
  );
}

type EditorPanelProps = {
  tracks: Track[];
  anchorPath: string | null;
  squareCover: boolean;
  onRenamed: (paths: string[]) => void;
  onClose: () => void;
};

export function EditorPanel({ tracks, anchorPath, squareCover, onRenamed, onClose }: EditorPanelProps) {
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  async function save(request: WriteTagsRequest, upload: File | null) {
    setOutcome(null);
    try {
      const results = await api.writeTags(request, upload);
      const failures = results.filter((result) => result.error);
      setOutcome({ saved: results.length - failures.length, failures });
    } catch (error) {
      setOutcome({ error: errorMessage(error) });
    }
  }

  return (
    <section className="panel panel-editor" aria-labelledby="editor-title">
      <div className="panel-heading">
        <h2 className="panel-title" id="editor-title">
          <span className="tape">Editor</span>
        </h2>
        <button type="button" className="button button-quiet editor-close" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="editor-subject">
        {tracks.length === 1 ? (tracks[0]?.name ?? "") : `${tracks.length} files selected`}
      </p>
      <TagForm
        key={tracks.map((track) => track.mtime).join(",")}
        tracks={tracks}
        anchorPath={anchorPath}
        squareCover={squareCover}
        onSave={save}
      />
      <div aria-live="polite">
        {outcome && "error" in outcome ? <p className="form-error">{outcome.error}</p> : null}
        {outcome && "saved" in outcome ? (
          <>
            {outcome.saved > 0 ? (
              <p className="form-ok">
                Wrote {outcome.saved} {outcome.saved === 1 ? "file" : "files"}.
              </p>
            ) : null}
            {outcome.failures.map((failure) => (
              <p className="form-error" key={failure.path}>
                {fileName(failure.path)}: {failure.error}
              </p>
            ))}
          </>
        ) : null}
      </div>
      <RenamePanel tracks={tracks} onRenamed={onRenamed} />
      <MusicBrainzPanel tracks={tracks} squareCover={squareCover} onApply={save} />
    </section>
  );
}
