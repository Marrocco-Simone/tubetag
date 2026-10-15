import { useState, useTransition, type FormEvent } from "react";
import type { MbCandidate, TagValues, Track } from "../shared/types.ts";
import { errorMessage } from "../shared/helpers.ts";
import { api } from "./api.ts";
import { sharedValue, Spinner, type SaveTags } from "./ui.tsx";

type MusicBrainzPanelProps = { tracks: Track[]; squareCover: boolean; onApply: SaveTags };

function quoted(value: string): string {
  return `"${value.replace(/["\\]/g, "\\$&")}"`;
}

function defaultQuery(tracks: Track[]): string {
  const first = tracks[0];
  if (!first) return "";
  if (tracks.length === 1) {
    const parts = [first.artist && `artist:${quoted(first.artist)}`, first.title && `recording:${quoted(first.title)}`];
    return parts.filter(Boolean).join(" AND ") || first.name.replace(/\.\w+$/, "");
  }
  const artist = sharedValue(tracks, "albumartist") || sharedValue(tracks, "artist") || first.artist;
  const album = sharedValue(tracks, "album") || first.album;
  return [artist && `artist:${quoted(artist)}`, album && `release:${quoted(album)}`].filter(Boolean).join(" AND ");
}

function coverArtUrl(releaseId: string, size: 250 | 500): string {
  return `https://coverartarchive.org/release/${releaseId}/front-${size}`;
}

export function MusicBrainzPanel({ tracks, squareCover, onApply }: MusicBrainzPanelProps) {
  const single = tracks.length === 1;
  const [query, setQuery] = useState(() => defaultQuery(tracks));
  const [candidates, setCandidates] = useState<MbCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [searching, startSearching] = useTransition();
  const [applying, startApplying] = useTransition();

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startSearching(async () => {
      try {
        setCandidates(await api.searchMusicBrainz(single ? "recording" : "release", query));
        setError(null);
      } catch (cause) {
        setError(errorMessage(cause));
      }
    });
  }

  function apply(candidate: MbCandidate) {
    const tags: TagValues = { album: candidate.release, albumartist: candidate.albumArtist };
    if (candidate.year) tags.year = candidate.year;
    if (single) {
      tags.artist = candidate.artist;
      if (candidate.title) tags.title = candidate.title;
      if (candidate.track) tags.track = candidate.track;
    }
    setApplyingId(candidate.id);
    startApplying(() =>
      onApply(
        {
          edits: tracks.map((track) => ({ path: track.path, tags })),
          cover: { kind: "url", url: coverArtUrl(candidate.releaseId, 500), whenMissing: "skip" },
          cropSquare: squareCover,
        },
        null,
      ),
    );
  }

  return (
    <details className="tool">
      <summary className="tool-summary">MusicBrainz lookup</summary>
      <div className="tool-body">
        <form className="inline-input" onSubmit={handleSearch} role="search">
          <input
            className="input"
            type="search"
            aria-label={single ? "Search recordings" : "Search releases"}
            value={query}
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button type="submit" className="button button-quiet" disabled={searching || !query.trim()}>
            {searching ? <Spinner label="Searching MusicBrainz" /> : null}
            Search
          </button>
        </form>
        <p className="field-help">
          {single ? "Searches recordings. Applies title, artist, track, album, year and cover." : "Searches releases. Applies album, album artist, year and cover."}
        </p>
        <p className="form-error" aria-live="polite">
          {error}
        </p>
        {candidates?.length === 0 ? <p className="empty">No matches. Try fewer words.</p> : null}
        {candidates && candidates.length > 0 ? (
          <ul className="candidates">
            {candidates.map((candidate) => (
              <li className="candidate" key={candidate.id}>
                <span className="candidate-cover">
                  <img
                    src={coverArtUrl(candidate.releaseId, 250)}
                    width={56}
                    height={56}
                    loading="lazy"
                    alt=""
                  />
                </span>
                <span className="candidate-text">
                  <strong>{candidate.title ?? candidate.release}</strong>
                  <span>{candidate.artist}</span>
                  <span className="muted">
                    {[candidate.title ? candidate.release : null, candidate.year, candidate.country, candidate.track && `#${candidate.track}`]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <button
                  type="button"
                  className="button button-quiet"
                  disabled={applying}
                  onClick={() => apply(candidate)}
                  aria-label={`Apply ${candidate.title ?? candidate.release} by ${candidate.artist}`}
                >
                  {applying && applyingId === candidate.id ? <Spinner label="Applying" /> : null}
                  Apply
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </details>
  );
}
