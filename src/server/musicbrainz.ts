import packageJson from "../../package.json" with { type: "json" };
import type { MbCandidate, MbSearchType } from "../shared/types.ts";
import { HttpError } from "./http.ts";
import { getSettings } from "./settings.ts";

const API_URL = "https://musicbrainz.org/ws/2";
const MIN_REQUEST_INTERVAL_MS = 1000;

type ArtistCredit = { name: string; joinphrase?: string }[];
type MbMedium = { "track-offset"?: number; "track-count"?: number; track?: { number?: string }[] };
type MbRelease = {
  id: string;
  title: string;
  date?: string;
  country?: string;
  "artist-credit"?: ArtistCredit;
  media?: MbMedium[];
};
type MbRecording = { id: string; title: string; "artist-credit"?: ArtistCredit; releases?: MbRelease[] };

let previousRequest: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

function userAgent(): string {
  const { musicbrainzContact } = getSettings();
  const product = `tubetag/${packageJson.version}`;
  return musicbrainzContact ? `${product} ( ${musicbrainzContact} )` : product;
}

function throttled<T>(task: () => Promise<T>): Promise<T> {
  const run = previousRequest.then(async () => {
    const wait = lastRequestAt + MIN_REQUEST_INTERVAL_MS - Date.now();
    if (wait > 0) await Bun.sleep(wait);
    lastRequestAt = Date.now();
    return task();
  });
  previousRequest = run.catch(() => undefined);
  return run;
}

function creditName(credit: ArtistCredit | undefined): string {
  return credit?.map((part) => part.name + (part.joinphrase ?? "")).join("") ?? "";
}

function trackNumber(release: MbRelease): string | null {
  const medium = release.media?.[0];
  if (!medium) return null;
  const listed = medium.track?.[0]?.number;
  const position = listed && /^\d+$/.test(listed) ? Number(listed) : (medium["track-offset"] ?? -1) + 1;
  if (position < 1) return null;
  return medium["track-count"] ? `${position}/${medium["track-count"]}` : String(position);
}

function toCandidate(release: MbRelease, recording: MbRecording | null): MbCandidate {
  return {
    id: recording ? `${recording.id}:${release.id}` : release.id,
    releaseId: release.id,
    title: recording?.title ?? null,
    artist: creditName(recording?.["artist-credit"] ?? release["artist-credit"]),
    release: release.title,
    albumArtist: creditName(release["artist-credit"] ?? recording?.["artist-credit"]),
    year: release.date?.slice(0, 4) || null,
    country: release.country ?? null,
    track: recording ? trackNumber(release) : null,
  };
}

export function parseSearchType(value: string | null): MbSearchType {
  if (value === "recording" || value === "release") return value;
  throw new HttpError(400, "Search type must be recording or release");
}

export async function searchMusicBrainz(type: MbSearchType, query: string): Promise<MbCandidate[]> {
  if (!query.trim() || query.length > 500) throw new HttpError(400, "Invalid search query");
  const url = `${API_URL}/${type}?query=${encodeURIComponent(query)}&fmt=json&limit=15`;
  const response = await throttled(() =>
    fetch(url, {
      headers: { "User-Agent": userAgent(), Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    }),
  );
  if (!response.ok) throw new HttpError(502, `MusicBrainz returned status ${response.status}`);
  if (type === "release") {
    const body = (await response.json()) as { releases?: MbRelease[] };
    return (body.releases ?? []).map((release) => toCandidate(release, null));
  }
  const body = (await response.json()) as { recordings?: MbRecording[] };
  return (body.recordings ?? [])
    .flatMap((recording) => (recording.releases ?? []).slice(0, 5).map((release) => toCandidate(release, recording)))
    .slice(0, 40);
}
