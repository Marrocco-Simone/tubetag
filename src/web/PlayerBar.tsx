import { useEffect, useEffectEvent, useRef, useState, type CSSProperties } from "react";
import type { Track } from "../shared/types.ts";
import { coverUrl } from "./api.ts";
import { CoverThumb, fileName } from "./ui.tsx";

export type PlayQueue = { paths: string[]; index: number };

type PlayerBarProps = {
  queue: PlayQueue;
  tracks: ReadonlyMap<string, Track>;
  playing: boolean;
  onPlayingChange: (playing: boolean) => void;
  onIndexChange: (index: number) => void;
};

const RESTART_THRESHOLD_SECONDS = 3;
const MEDIA_ACTIONS = ["play", "pause", "previoustrack", "nexttrack"] as const;
type MediaAction = (typeof MEDIA_ACTIONS)[number];

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0:00";
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const secondsPart = String(whole % 60).padStart(2, "0");
  if (minutes < 60) return `${minutes}:${secondsPart}`;
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${secondsPart}`;
}

function audioUrl(path: string): string {
  return `/api/audio?${new URLSearchParams({ path })}`;
}

function Icon({ name }: { name: "previous" | "play" | "pause" | "next" | "volume" }) {
  const paths = {
    previous: "M6 5h2v14H6zM20 5v14L9.5 12z",
    play: "M8 5v14l11-7z",
    pause: "M7 5h4v14H7zM13 5h4v14h-4z",
    next: "M16 5h2v14h-2zM4 5v14l10.5-7z",
    volume: "M4 9v6h4l5 4V5L8 9zm11.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM13 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z",
  };
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
      <path d={paths[name]} fill="currentColor" />
    </svg>
  );
}

export function PlayerBar({ queue, tracks, playing, onPlayingChange, onIndexChange }: PlayerBarProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [scrubTime, setScrubTime] = useState<number | null>(null);
  const [volume, setVolume] = useState(1);
  const [loadError, setLoadError] = useState(false);
  const path = queue.paths[queue.index] ?? "";
  const track = tracks.get(path);
  const title = track?.title ?? fileName(path);
  const details = [track?.artist, track?.album, track?.year].filter(Boolean).join(" • ");
  const hasNext = queue.index < queue.paths.length - 1;
  const shownTime = scrubTime ?? currentTime;
  const artworkUrl = track?.hasCover ? new URL(coverUrl(track), location.href).href : null;

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => onPlayingChange(false));
    else audio.pause();
  }

  function previous() {
    const audio = audioRef.current;
    if (audio && (audio.currentTime > RESTART_THRESHOLD_SECONDS || queue.index === 0)) audio.currentTime = 0;
    else onIndexChange(queue.index - 1);
  }

  function next() {
    if (hasNext) onIndexChange(queue.index + 1);
  }

  function commitScrub() {
    if (scrubTime === null) return;
    if (audioRef.current) audioRef.current.currentTime = scrubTime;
    setCurrentTime(scrubTime);
    setScrubTime(null);
  }

  function changePlaying(next: boolean) {
    onPlayingChange(next);
    navigator.mediaSession.playbackState = next ? "playing" : "paused";
  }

  const onMediaAction = useEffectEvent((action: MediaAction) => {
    if (action === "play") void audioRef.current?.play();
    else if (action === "pause") audioRef.current?.pause();
    else if (action === "previoustrack") previous();
    else next();
  });

  useEffect(() => {
    for (const action of MEDIA_ACTIONS) navigator.mediaSession.setActionHandler(action, () => onMediaAction(action));
    return () => {
      for (const action of MEDIA_ACTIONS) navigator.mediaSession.setActionHandler(action, null);
    };
  }, []);

  useEffect(() => {
    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist: track?.artist ?? "",
      album: track?.album ?? "",
      artwork: artworkUrl ? [{ src: artworkUrl }] : [],
    });
  }, [title, track?.artist, track?.album, artworkUrl]);

  return (
    <section className="player" aria-label="Player">
      <audio
        ref={audioRef}
        src={audioUrl(path)}
        autoPlay
        preload="auto"
        onLoadStart={() => {
          setLoadError(false);
          setCurrentTime(0);
        }}
        onPlay={() => changePlaying(true)}
        onPause={() => changePlaying(false)}
        onEnded={next}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onDurationChange={(event) => setDuration(event.currentTarget.duration)}
        onError={() => setLoadError(true)}
      />
      <input
        className="player-seek"
        type="range"
        min={0}
        max={duration || 0}
        step="any"
        value={Math.min(shownTime, duration || 0)}
        aria-label="Seek"
        aria-valuetext={`${formatTime(shownTime)} of ${formatTime(duration)}`}
        style={{ "--progress": `${duration ? (shownTime / duration) * 100 : 0}%` } as CSSProperties}
        onChange={(event) => setScrubTime(Number(event.target.value))}
        onPointerUp={commitScrub}
        onKeyUp={commitScrub}
        onBlur={commitScrub}
      />
      <div className="player-controls">
        <button type="button" className="player-button" onClick={previous} aria-label="Previous">
          <Icon name="previous" />
        </button>
        <button
          type="button"
          className="player-button player-toggle"
          onClick={togglePlay}
          aria-label={playing ? "Pause" : "Play"}
        >
          <Icon name={playing ? "pause" : "play"} />
        </button>
        <button type="button" className="player-button" onClick={next} disabled={!hasNext} aria-label="Next">
          <Icon name="next" />
        </button>
        <span className="player-time">
          {formatTime(shownTime)} / {formatTime(duration)}
        </span>
      </div>
      <div className="player-now">
        {track ? <CoverThumb track={track} size={44} /> : <span className="cover cover-empty player-cover" />}
        <span className="player-text">
          <span className="player-title" title={title}>
            {title}
          </span>
          <span className="player-details">{loadError ? "This file cannot be played." : details}</span>
        </span>
      </div>
      <label className="player-volume">
        <Icon name="volume" />
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          aria-label="Volume"
          style={{ "--progress": `${volume * 100}%` } as CSSProperties}
          onChange={(event) => {
            const value = Number(event.target.value);
            setVolume(value);
            if (audioRef.current) audioRef.current.volume = value;
          }}
        />
      </label>
    </section>
  );
}
