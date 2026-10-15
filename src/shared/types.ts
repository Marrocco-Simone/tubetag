export type ClipboardWatch = "running" | "paused";

export type Settings = {
  outputDir: string;
  clipboardWatch: ClipboardWatch;
  squareCover: boolean;
  musicbrainzContact: string;
};

export type JobStatus = "awaiting-choice" | "queued" | "downloading" | "done" | "failed";
export type JobKind = "video" | "playlist";
export type JobChoice = "video" | "playlist" | "cancel";

export type MissingSong = { id: string; index: number | null; title: string | null };
export type ArmedReplacement = { folder: string; song: MissingSong };

export type Job = {
  id: string;
  url: string;
  kind: JobKind;
  playlistUrl: string | null;
  status: JobStatus;
  title: string | null;
  progress: number;
  itemIndex: number | null;
  itemCount: number | null;
  files: string[];
  folder: string | null;
  missing: MissingSong[];
  replaces: ArmedReplacement | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type ServerEvent =
  | { type: "jobs"; jobs: Job[] }
  | { type: "job"; job: Job }
  | { type: "job-removed"; id: string }
  | { type: "armed"; armed: ArmedReplacement | null }
  | { type: "library" };

export const TAG_FIELDS = ["title", "artist", "album", "albumartist", "year", "genre", "track"] as const;
export type TagField = (typeof TAG_FIELDS)[number];
export type TagValues = Partial<Record<TagField, string>>;

export type Track = {
  path: string;
  folder: string;
  name: string;
  mtime: number;
  title: string | null;
  artist: string | null;
  album: string | null;
  albumartist: string | null;
  year: string | null;
  genre: string | null;
  track: number | null;
  hasCover: boolean;
  videoId: string | null;
};

export type Library = { outputDir: string; tracks: Track[]; missing: Record<string, MissingSong[]> };

export type CoverSource =
  | { kind: "upload" }
  | { kind: "url"; url: string; whenMissing: "fail" | "skip" }
  | { kind: "file"; path: string };

export type WriteTagsRequest = {
  edits: { path: string; tags: TagValues }[];
  cover: CoverSource | null;
  cropSquare: boolean;
};

export type WriteResult = { path: string; error: string | null };

export type RenameRequest = { paths: string[]; pattern: string };
export type RenameItem = { path: string; newPath: string; problem: string | null };

export type MbSearchType = "recording" | "release";

export type MbCandidate = {
  id: string;
  releaseId: string;
  title: string | null;
  artist: string;
  release: string;
  albumArtist: string;
  year: string | null;
  country: string | null;
  track: string | null;
};
