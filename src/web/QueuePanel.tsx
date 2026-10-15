import { useState, useTransition, type FormEvent } from "react";
import type { Job, JobStatus, Settings } from "../shared/types.ts";
import { errorMessage } from "../shared/helpers.ts";
import { api } from "./api.ts";
import { Spinner } from "./ui.tsx";

type QueuePanelProps = {
  jobs: Job[];
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
  onShowMissing: (folder: string) => void;
};

const STATUS_LABELS: Record<JobStatus, string> = {
  "awaiting-choice": "Waiting for your choice",
  queued: "Queued",
  downloading: "Downloading",
  done: "Done",
  failed: "Failed",
};

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });

function doneNote(job: Job): string | null {
  if (job.status !== "done") return null;
  if (job.replaces) {
    return `Replaced “${job.replaces.song.title ?? job.replaces.song.id}” in ${job.replaces.folder || "Output folder"}`;
  }
  if (job.files.length === 0) return "Already downloaded";
  return `${job.files.length} ${job.files.length === 1 ? "file" : "files"} saved`;
}

function JobRow({ job, onShowMissing }: { job: Job; onShowMissing: (folder: string) => void }) {
  const isPlaylist = job.kind === "playlist";
  const missingFolder = job.missing.length > 0 ? job.folder : null;
  const position = job.itemIndex && job.itemCount ? `${job.itemIndex} / ${job.itemCount}` : null;
  const progress = Math.round(job.progress);
  const savedNote = doneNote(job);
  return (
    <li className="job" data-status={job.status}>
      <div className="job-head">
        <span className="job-status">{STATUS_LABELS[job.status]}</span>
        <span>{isPlaylist ? "Playlist" : "Track"}</span>
        {position ? <span className="job-position">{position}</span> : null}
        <time className="job-time" dateTime={job.finishedAt ?? job.startedAt ?? job.createdAt}>
          {timeFormat.format(new Date(job.finishedAt ?? job.startedAt ?? job.createdAt))}
        </time>
      </div>
      <p className="job-title" title={job.url}>
        {job.title ?? job.url}
      </p>
      {job.status === "downloading" ? (
        <div
          className="progress"
          role="progressbar"
          aria-label={`Download progress of ${job.title ?? job.url}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
        >
          <span className="progress-fill" style={{ transform: `scaleX(${progress / 100})` }} />
        </div>
      ) : null}
      {savedNote ? <p className="job-note">{savedNote}</p> : null}
      {missingFolder !== null ? (
        <p className="job-note">
          <a href="#library" className="job-missing-link" onClick={() => onShowMissing(missingFolder)}>
            {job.missing.length} {job.missing.length === 1 ? "song" : "songs"} unavailable
          </a>
        </p>
      ) : null}
      {job.error ? <p className="job-error">{job.error}</p> : null}
    </li>
  );
}

export function QueuePanel({ jobs, settings, onSettingsChange, onShowMissing }: QueuePanelProps) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [adding, startAdding] = useTransition();
  const [toggling, startToggling] = useTransition();
  const watching = settings.clipboardWatch === "running";

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startAdding(async () => {
      try {
        await api.addJob(url);
        setUrl("");
        setError(null);
      } catch (cause) {
        setError(errorMessage(cause));
      }
    });
  }

  function toggleWatch() {
    startToggling(async () => {
      try {
        onSettingsChange(await api.updateSettings({ clipboardWatch: watching ? "paused" : "running" }));
        setError(null);
      } catch (cause) {
        setError(errorMessage(cause));
      }
    });
  }

  return (
    <section className="panel panel-queue" aria-labelledby="queue-title">
      <h2 className="panel-title" id="queue-title">
        <span className="tape">Downloads</span>
      </h2>
      <div className="intake">
        <button
          type="button"
          role="switch"
          aria-checked={watching}
          className="watch-switch"
          onClick={toggleWatch}
          disabled={toggling}
        >
          <span className="watch-light" aria-hidden="true" />
          <span className="watch-text">
            <strong>Clipboard watch</strong>
            <span>{watching ? "Copied YouTube links download right away" : "Paused. Copied links are ignored"}</span>
          </span>
          {toggling ? <Spinner label="Updating clipboard watch" /> : null}
        </button>
        <form className="add-form" onSubmit={handleSubmit}>
          <label className="visually-hidden" htmlFor="add-url">
            YouTube or YouTube Music link
          </label>
          <input
            id="add-url"
            className="input"
            type="url"
            name="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="Paste a YouTube link…"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            required
          />
          <button type="submit" className="button button-tape" disabled={adding}>
            {adding ? <Spinner label="Adding" /> : null}
            Add
          </button>
        </form>
      </div>
      <p className="form-error" aria-live="polite">
        {error}
      </p>
      {jobs.length === 0 ? (
        <p className="empty">Nothing downloaded in this session yet.</p>
      ) : (
        <ol className="job-list" aria-live="polite" aria-relevant="additions">
          {jobs.toReversed().map((job) => (
            <JobRow key={job.id} job={job} onShowMissing={onShowMissing} />
          ))}
        </ol>
      )}
    </section>
  );
}
