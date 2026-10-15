import { useDeferredValue, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import type { ArmedReplacement, Library, MissingSong, Track } from "../shared/types.ts";
import { CoverThumb, Spinner } from "./ui.tsx";

type LibraryPanelProps = {
  library: Library;
  error: string | null;
  refreshing: boolean;
  selection: ReadonlySet<string>;
  anchor: string | null;
  playingPath: string | null;
  playing: boolean;
  focusFolder: string | null;
  armed: ArmedReplacement | null;
  onArm: (folder: string, id: string) => void;
  onSelect: (selection: ReadonlySet<string>, anchor: string | null) => void;
  onRefresh: () => void;
  onPlay: (paths: string[], index: number) => void;
};

const MODIFIER_KEY = /Mac/.test(navigator.userAgent) ? "⌘" : "Ctrl";

type FolderGroup = { folder: string; tracks: Track[] };

function foldText(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

function groupByFolder(tracks: Track[], missingFolders: string[]): FolderGroup[] {
  const groups: FolderGroup[] = [];
  for (const track of tracks) {
    const last = groups.at(-1);
    if (last?.folder === track.folder) last.tracks.push(track);
    else groups.push({ folder: track.folder, tracks: [track] });
  }
  const present = new Set(groups.map((group) => group.folder));
  for (const folder of missingFolders) if (!present.has(folder)) groups.push({ folder, tracks: [] });
  return groups.sort((a, b) => a.folder.localeCompare(b.folder));
}

function youtubeSearchUrl(title: string): string {
  return `https://www.youtube.com/results?${new URLSearchParams({ search_query: title })}`;
}

type MissingSongsProps = {
  songs: MissingSong[];
  focused: boolean;
  armedId: string | null;
  onArm: (id: string) => void;
};

function MissingSongs({ songs, focused, armedId, onArm }: MissingSongsProps) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (focused) detailsRef.current?.scrollIntoView({ block: "start" });
  }, [focused]);

  return (
    <details
      className="missing"
      ref={detailsRef}
      open={open || focused || armedId !== null}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="missing-summary">Not downloaded ({songs.length})</summary>
      <ol className="missing-list">
        {songs.map((song) => (
          <li className="missing-row" key={song.id} data-armed={song.id === armedId ? "" : undefined}>
            <span className="missing-index">{song.index ?? "–"}</span>
            <span className="missing-title">
              {song.title ?? <span className="muted">{song.id} · removed by the owner</span>}
            </span>
            <span className="missing-actions">
              {song.title ? (
                <a
                  className="missing-link"
                  href={youtubeSearchUrl(song.title)}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => onArm(song.id)}
                >
                  Search on YouTube
                </a>
              ) : null}
              <button
                type="button"
                className="button button-quiet missing-replace"
                aria-pressed={song.id === armedId}
                onClick={() => onArm(song.id)}
              >
                Replace
              </button>
            </span>
          </li>
        ))}
      </ol>
    </details>
  );
}

export function LibraryPanel({
  library,
  error,
  refreshing,
  selection,
  anchor,
  playingPath,
  playing,
  focusFolder,
  armed,
  onArm,
  onSelect,
  onRefresh,
  onPlay,
}: LibraryPanelProps) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const searchText = useMemo(
    () =>
      new Map(
        library.tracks.map((track) => [
          track.path,
          foldText([track.title, track.artist, track.album, track.name].filter(Boolean).join(" ")),
        ]),
      ),
    [library],
  );
  const words = foldText(deferredQuery).split(/\s+/).filter(Boolean);
  const visibleTracks =
    words.length === 0
      ? library.tracks
      : library.tracks.filter((track) => words.every((word) => searchText.get(track.path)?.includes(word)));
  const groups = groupByFolder(visibleTracks, words.length === 0 ? Object.keys(library.missing) : []);
  const total = library.tracks.length;
  const countText =
    words.length > 0 ? `${visibleTracks.length} of ${total} songs` : `${total} ${total === 1 ? "song" : "songs"}`;

  function handleTrackClick(event: MouseEvent<HTMLButtonElement>, path: string) {
    const additive = event.metaKey || event.ctrlKey;
    const order = visibleTracks.map((track) => track.path);
    const anchorIndex = anchor ? order.indexOf(anchor) : -1;
    if (event.shiftKey && anchorIndex !== -1) {
      const index = order.indexOf(path);
      const range = order.slice(Math.min(anchorIndex, index), Math.max(anchorIndex, index) + 1);
      onSelect(new Set(additive ? [...selection, ...range] : range), anchor);
      return;
    }
    if (!additive) return onSelect(new Set([path]), path);
    const next = new Set(selection);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    onSelect(next, path);
  }

  function toggleFolder(group: FolderGroup, selectAll: boolean) {
    const next = new Set(selection);
    for (const track of group.tracks) {
      if (selectAll) next.add(track.path);
      else next.delete(track.path);
    }
    onSelect(next, group.tracks[0]?.path ?? null);
  }

  return (
    <section className="panel panel-library" aria-labelledby="library-title">
      <div className="panel-heading">
        <h2 className="panel-title" id="library-title">
          <span className="tape">Library</span>
        </h2>
        <p className="library-root" title={library.outputDir}>
          <bdi>{library.outputDir}</bdi>
        </p>
        <button type="button" className="button button-quiet" onClick={onRefresh} disabled={refreshing}>
          {refreshing ? <Spinner label="Refreshing library…" /> : null}
          Refresh
        </button>
      </div>
      <div className="library-search" role="search">
        <input
          className="input"
          type="search"
          name="library-search"
          aria-label="Search songs"
          placeholder="Search title, artist, album or file name…"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <p className="library-hint" aria-live="polite">
        {selection.size > 0
          ? `${countText} · ${selection.size} selected · Shift-click selects a range, ${MODIFIER_KEY}-click adds`
          : `${countText} · Double-click a song to play it`}
      </p>
      {groups.length === 0 && words.length === 0 ? (
        <p className="empty">No audio files yet. Copy a YouTube link and it shows up here.</p>
      ) : null}
      {groups.length === 0 && words.length > 0 ? <p className="empty">No songs match “{deferredQuery}”.</p> : null}
      {/* limit: renders every row; per-folder content-visibility keeps paint cheap, but libraries with many thousand files need list virtualization. */}
      <div className="folders">
        {groups.map((group) => {
          const selectedCount = group.tracks.filter((track) => selection.has(track.path)).length;
          const allSelected = group.tracks.length > 0 && selectedCount === group.tracks.length;
          const folderLabel = group.folder || "Output folder";
          const folderPaths = group.tracks.map((track) => track.path);
          const missing = library.missing[group.folder];
          return (
            <section className="folder" key={group.folder} aria-label={folderLabel}>
              <header className="folder-head">
                <label className="folder-select">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    disabled={group.tracks.length === 0}
                    ref={(input) => {
                      if (input) input.indeterminate = selectedCount > 0 && !allSelected;
                    }}
                    onChange={() => toggleFolder(group, !allSelected)}
                    aria-label={`Select all shown songs in ${folderLabel}`}
                  />
                </label>
                <h3 className="folder-name">{folderLabel}</h3>
                <span className="folder-count">{group.tracks.length}</span>
              </header>
              <ul className="track-list">
                {group.tracks.map((track, index) => {
                  const title = track.title ?? track.name;
                  const isCurrent = track.path === playingPath;
                  const isSelected = selection.has(track.path);
                  return (
                    <li
                      key={track.path}
                      className="track-item"
                      data-selected={isSelected ? "" : undefined}
                      data-current={isCurrent ? "" : undefined}
                    >
                      <button
                        type="button"
                        className="track-play"
                        aria-label={`Play ${title}`}
                        onClick={() => onPlay(folderPaths, index)}
                      >
                        <CoverThumb track={track} size={40} />
                        <svg className="track-play-icon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                          <path d="M8 5v14l11-7z" fill="currentColor" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        className="track-row"
                        aria-pressed={isSelected}
                        onClick={(event) => handleTrackClick(event, track.path)}
                        onDoubleClick={() => onPlay(folderPaths, index)}
                      >
                        <span className="track-number">
                          {isCurrent ? (
                            <span className="equalizer" data-paused={playing ? undefined : ""}>
                              <i />
                              <i />
                              <i />
                              <span className="visually-hidden">{playing ? "Playing" : "Paused"}</span>
                            </span>
                          ) : (
                            (track.track ?? "–")
                          )}
                        </span>
                        <span className="track-main">
                          <span className="track-title">{title}</span>
                          <span className="track-artist">{track.artist ?? "Unknown artist"}</span>
                        </span>
                        <span className="track-album">{track.album ?? ""}</span>
                        <span className="track-year">{track.year ?? ""}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {missing && missing.length > 0 ? (
                <MissingSongs
                  songs={missing}
                  focused={focusFolder === group.folder}
                  armedId={armed?.folder === group.folder ? armed.song.id : null}
                  onArm={(id) => onArm(group.folder, id)}
                />
              ) : null}
            </section>
          );
        })}
      </div>
    </section>
  );
}
