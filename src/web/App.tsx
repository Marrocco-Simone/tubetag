import { Activity, useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ArmedReplacement, Job, Library, ServerEvent, Settings } from "../shared/types.ts";
import { errorMessage } from "../shared/helpers.ts";
import { api } from "./api.ts";
import { ChoiceDialog } from "./ChoiceDialog.tsx";
import { EditorPanel } from "./EditorPanel.tsx";
import { LibraryPanel } from "./LibraryPanel.tsx";
import { PlayerBar, type PlayQueue } from "./PlayerBar.tsx";
import { QueuePanel } from "./QueuePanel.tsx";
import { SettingsDialog } from "./SettingsDialog.tsx";

type AppProps = { initialSettings: Settings; initialLibrary: Library };
type Page = "downloads" | "library";

function subscribeToHash(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

function readPage(): Page {
  return location.hash === "#library" ? "library" : "downloads";
}

function upsertJob(jobs: Job[], job: Job): Job[] {
  const index = jobs.findIndex((candidate) => candidate.id === job.id);
  return index === -1 ? [...jobs, job] : jobs.with(index, job);
}

export function App({ initialSettings, initialLibrary }: AppProps) {
  const [settings, setSettings] = useState(initialSettings);
  const [library, setLibrary] = useState(initialLibrary);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [connected, setConnected] = useState(true);
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [playQueue, setPlayQueue] = useState<PlayQueue | null>(null);
  const [playing, setPlaying] = useState(false);
  const [focusFolder, setFocusFolder] = useState<string | null>(null);
  const [armed, setArmed] = useState<ArmedReplacement | null>(null);
  const [armError, setArmError] = useState<string | null>(null);
  const page = useSyncExternalStore(subscribeToHash, readPage);
  const latestRefresh = useRef(0);

  function refreshLibrary() {
    const id = ++latestRefresh.current;
    setRefreshing(true);
    api
      .library()
      .then((next) => {
        if (id !== latestRefresh.current) return;
        setLibrary(next);
        setLibraryError(null);
      })
      .catch((error) => {
        if (id === latestRefresh.current) setLibraryError(errorMessage(error));
      })
      .finally(() => {
        if (id === latestRefresh.current) setRefreshing(false);
      });
  }

  const onServerEvent = useEffectEvent((event: ServerEvent) => {
    if (event.type === "jobs") setJobs(event.jobs);
    else if (event.type === "job") setJobs((current) => upsertJob(current, event.job));
    else if (event.type === "job-removed") setJobs((current) => current.filter((job) => job.id !== event.id));
    else if (event.type === "armed") setArmed(event.armed);
    else refreshLibrary();
  });

  useEffect(() => {
    const socket = new WebSocket(`ws://${location.host}/ws`);
    socket.onopen = () => setConnected(true);
    socket.onclose = () => setConnected(false);
    socket.onmessage = (message) => onServerEvent(JSON.parse(String(message.data)) as ServerEvent);
    return () => {
      socket.onclose = null;
      socket.close();
    };
  }, []);

  const selectedTracks = useMemo(
    () => library.tracks.filter((track) => selection.has(track.path)),
    [library, selection],
  );

  const tracksByPath = useMemo(() => new Map(library.tracks.map((track) => [track.path, track])), [library]);
  const pendingChoice = jobs.find((job) => job.status === "awaiting-choice");
  const activeJobs = jobs.filter((job) => job.status !== "done" && job.status !== "failed").length;
  const playingPath = playQueue ? (playQueue.paths[playQueue.index] ?? null) : null;

  function resolveChoice(id: string, job: Job | null) {
    setJobs((current) => (job ? upsertJob(current, job) : current.filter((candidate) => candidate.id !== id)));
  }

  function changeArmed(request: Promise<ArmedReplacement | null>) {
    request.then(
      (next) => {
        setArmed(next);
        setArmError(null);
      },
      (error) => setArmError(errorMessage(error)),
    );
  }

  function select(next: ReadonlySet<string>, nextAnchor: string | null) {
    setSelection(next);
    setAnchor(nextAnchor);
  }

  return (
    <div className="app">
      <header className="masthead">
        <h1 className="brand">
          <span className="tape tape-brand" translate="no">
            tubetag
          </span>
        </h1>
        <nav className="page-nav" aria-label="Pages">
          <a href="#downloads" className="page-link" aria-current={page === "downloads" ? "page" : undefined}>
            Downloads
            {activeJobs > 0 ? <span className="page-count">{activeJobs}</span> : null}
          </a>
          <a
            href="#library"
            className="page-link"
            aria-current={page === "library" ? "page" : undefined}
            onClick={() => setFocusFolder(null)}
          >
            Library
            <span className="page-count">{library.tracks.length}</span>
          </a>
        </nav>
        {connected ? null : (
          <p className="connection-lost" role="alert">
            Lost connection to the tubetag server. Restart it and reload this page.
          </p>
        )}
        <button type="button" className="button button-quiet" onClick={() => setSettingsOpen(true)}>
          Settings
        </button>
        {armed ? (
          <div className="armed-banner" role="status">
            <p>
              Next copied video link replaces “{armed.song.title ?? armed.song.id}” in {armed.folder || "Output folder"}
            </p>
            <button
              type="button"
              className="button button-quiet"
              onClick={() => changeArmed(api.disarmReplacement())}
            >
              Cancel
            </button>
          </div>
        ) : null}
        {armError ? (
          <p className="armed-error" role="alert">
            {armError}
          </p>
        ) : null}
      </header>
      <main className="page">
        <Activity mode={page === "downloads" ? "visible" : "hidden"}>
          <div className="page-downloads">
            <QueuePanel jobs={jobs} settings={settings} onSettingsChange={setSettings} onShowMissing={setFocusFolder} />
          </div>
        </Activity>
        <Activity mode={page === "library" ? "visible" : "hidden"}>
          <div className="page-library" data-editor-open={selectedTracks.length > 0 ? "" : undefined}>
            <LibraryPanel
              library={library}
              error={libraryError}
              refreshing={refreshing}
              selection={selection}
              anchor={anchor}
              playingPath={playingPath}
              playing={playing}
              focusFolder={focusFolder}
              armed={armed}
              onArm={(folder, id) => changeArmed(api.armReplacement(folder, id))}
              onSelect={select}
              onRefresh={refreshLibrary}
              onPlay={(paths, index) => setPlayQueue({ paths, index })}
            />
            {selectedTracks.length > 0 ? (
              <EditorPanel
                key={selectedTracks.map((track) => track.path).join("\n")}
                tracks={selectedTracks}
                anchorPath={anchor}
                squareCover={settings.squareCover}
                onRenamed={(paths) => select(new Set(paths), paths[0] ?? null)}
                onClose={() => select(new Set(), null)}
              />
            ) : null}
          </div>
        </Activity>
      </main>
      {playQueue ? (
        <PlayerBar
          queue={playQueue}
          tracks={tracksByPath}
          playing={playing}
          onPlayingChange={setPlaying}
          onIndexChange={(index) => setPlayQueue({ ...playQueue, index })}
        />
      ) : null}
      {pendingChoice ? <ChoiceDialog key={pendingChoice.id} job={pendingChoice} onResolved={resolveChoice} /> : null}
      {settingsOpen ? (
        <SettingsDialog settings={settings} onSaved={setSettings} onClose={() => setSettingsOpen(false)} />
      ) : null}
    </div>
  );
}
