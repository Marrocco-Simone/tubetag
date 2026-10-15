import type { TagField, Track, WriteTagsRequest } from "../shared/types.ts";
import { coverUrl } from "./api.ts";

export type SaveTags = (request: WriteTagsRequest, upload: File | null) => Promise<void>;
export type EditableField = Exclude<TagField, "track">;

export function sharedValue(tracks: Track[], field: EditableField): string | null {
  const first = tracks[0]?.[field] ?? "";
  return tracks.every((track) => (track[field] ?? "") === first) ? first : null;
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return <span className="spinner" role="status" aria-label={label} />;
}

export function CoverThumb({ track, size }: { track: Track; size: number }) {
  if (!track.hasCover) return <span className="cover cover-empty" style={{ width: size, height: size }} aria-hidden="true" />;
  return <img className="cover" src={coverUrl(track)} width={size} height={size} loading="lazy" alt="" />;
}

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
