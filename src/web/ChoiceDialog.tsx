import { useState, useTransition } from "react";
import { errorMessage, isMix, MIX_ITEM_LIMIT } from "../shared/helpers.ts";
import type { Job, JobChoice } from "../shared/types.ts";
import { api } from "./api.ts";
import { Spinner } from "./ui.tsx";

type ChoiceDialogProps = { job: Job; onResolved: (id: string, job: Job | null) => void };

const CHOICES: { choice: JobChoice; label: string; className: string }[] = [
  { choice: "video", label: "This video only", className: "button button-tape" },
  { choice: "playlist", label: "Whole playlist", className: "button" },
  { choice: "cancel", label: "Cancel", className: "button button-quiet" },
];

export function ChoiceDialog({ job, onResolved }: ChoiceDialogProps) {
  const [choice, setChoice] = useState<JobChoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function choose(next: JobChoice) {
    setChoice(next);
    startTransition(async () => {
      try {
        onResolved(job.id, await api.chooseJob(job.id, next));
      } catch (cause) {
        setError(errorMessage(cause));
      }
    });
  }

  return (
    <dialog
      className="dialog"
      aria-labelledby="choice-title"
      aria-describedby="choice-subject"
      ref={(dialog) => {
        if (dialog && !dialog.open) dialog.showModal();
      }}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) choose("cancel");
      }}
    >
      <h2 className="panel-title" id="choice-title">
        <span className="tape">Playlist link</span>
      </h2>
      <p className="choice-question">This video is part of a playlist. What do you want to download?</p>
      <p className="choice-subject" id="choice-subject" title={job.url}>
        {job.title ?? job.url}
      </p>
      {isMix(job.playlistUrl) ? (
        <p className="choice-note">This playlist is a mix. YouTube generates mixes automatically, so tubetag downloads only the first {MIX_ITEM_LIMIT} songs.</p>
      ) : null}
      <p className="form-error" aria-live="polite">
        {error}
      </p>
      <div className="dialog-actions">
        {CHOICES.map((option) => (
          <button
            key={option.choice}
            type="button"
            className={option.className}
            disabled={pending}
            onClick={() => choose(option.choice)}
          >
            {pending && choice === option.choice ? <Spinner label="Saving your choice…" /> : null}
            {option.label}
          </button>
        ))}
      </div>
    </dialog>
  );
}
