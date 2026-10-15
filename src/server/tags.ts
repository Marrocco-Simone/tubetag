import { mkdtemp, readdir, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, relative } from "node:path";
import { parseFile, selectCover } from "music-metadata";
import {
  TAG_FIELDS,
  type CoverSource,
  type Library,
  type TagField,
  type TagValues,
  type Track,
  type WriteResult,
  type WriteTagsRequest,
} from "../shared/types.ts";
import { errorMessage } from "../shared/helpers.ts";
import { HttpError, isRecord, MAX_BATCH_FILES, readString } from "./http.ts";
import { readMissing } from "./missing.ts";
import { getSettings, resolveLibraryPath } from "./settings.ts";

const AUDIO_EXTENSIONS = new Set([".m4a", ".mp3"]);
const MAX_COVER_BYTES = 20 * 1024 * 1024;
const SCAN_BATCH = 16;
const FFMPEG_KEYS: Record<TagField, string> = {
  title: "title",
  artist: "artist",
  album: "album",
  albumartist: "album_artist",
  year: "date",
  genre: "genre",
  track: "track",
};

const VIDEO_URL_ID = /[?&]v=([\w-]{11})/;
const FILE_NAME_ID = /\[([\w-]{11})\]\.\w+$/;

const trackCache = new Map<string, Track>();

function isLibraryFile(name: string): boolean {
  const file = basename(name);
  return AUDIO_EXTENSIONS.has(extname(file).toLowerCase()) && !file.startsWith(".") && !/\.temp\.\w+$/.test(file);
}

export function resolveAudioPath(path: unknown): string {
  const absolute = resolveLibraryPath(path);
  if (!AUDIO_EXTENSIONS.has(extname(absolute).toLowerCase())) throw new HttpError(400, "Not an audio file");
  return absolute;
}

export async function readTrack(absolute: string): Promise<Track> {
  const path = relative(getSettings().outputDir, absolute);
  const { mtimeMs } = await stat(absolute);
  const cached = trackCache.get(absolute);
  if (cached && cached.mtime === mtimeMs && cached.path === path) return cached;
  const common = await parseFile(absolute, { duration: false }).then(
    (metadata) => metadata.common,
    (error) => {
      console.warn(`Cannot read tags of ${absolute}:`, errorMessage(error));
      return null;
    },
  );
  const folder = dirname(path);
  const track: Track = {
    path,
    folder: folder === "." ? "" : folder,
    name: basename(path),
    mtime: mtimeMs,
    title: common?.title ?? null,
    artist: common?.artist ?? null,
    album: common?.album ?? null,
    albumartist: common?.albumartist ?? null,
    year: common?.year ? String(common.year) : null,
    genre: common?.genre?.[0] ?? null,
    track: common?.track.no ?? null,
    hasCover: (common?.picture?.length ?? 0) > 0,
    videoId:
      common?.comment?.map((comment) => comment.text?.match(VIDEO_URL_ID)?.[1]).find(Boolean) ??
      path.match(FILE_NAME_ID)?.[1] ??
      null,
  };
  trackCache.set(absolute, track);
  return track;
}

function compareTracks(a: Track, b: Track): number {
  return (
    a.folder.localeCompare(b.folder) ||
    (a.track ?? Number.MAX_SAFE_INTEGER) - (b.track ?? Number.MAX_SAFE_INTEGER) ||
    a.name.localeCompare(b.name)
  );
}

export async function scanLibrary(): Promise<Library> {
  const { outputDir } = getSettings();
  const entries = await readdir(outputDir, { recursive: true });
  const files = entries.filter(isLibraryFile).map((entry) => join(outputDir, entry));
  const tracks: Track[] = [];
  for (let i = 0; i < files.length; i += SCAN_BATCH) {
    tracks.push(...(await Promise.all(files.slice(i, i + SCAN_BATCH).map(readTrack))));
  }
  const present = new Set(files);
  for (const key of trackCache.keys()) if (!present.has(key)) trackCache.delete(key);
  return { outputDir, tracks: tracks.sort(compareTracks), missing: await readMissing() };
}

export async function readCover(absolute: string): Promise<{ data: Uint8Array; format: string } | null> {
  const { common } = await parseFile(absolute, { duration: false });
  const picture = selectCover(common.picture);
  return picture ? { data: picture.data, format: picture.format } : null;
}

async function runFfmpeg(args: string[]): Promise<void> {
  const proc = Bun.spawn(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", ...args], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
  });
  const [exitCode, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
  if (exitCode !== 0) throw new Error(stderr.trim().split("\n").pop() || `ffmpeg exited with code ${exitCode}`);
}

const COVER_TOO_LARGE = "Cover image is larger than 20 MB";

async function readCapped(body: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of body) {
    size += chunk.byteLength;
    if (size > MAX_COVER_BYTES) throw new HttpError(400, COVER_TOO_LARGE);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function downloadImage(rawUrl: string, whenMissing: "fail" | "skip"): Promise<Uint8Array | null> {
  const url = URL.parse(rawUrl);
  if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) throw new HttpError(400, "Invalid cover URL");
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (response.status === 404 && whenMissing === "skip") return null;
  if (!response.ok || !response.body) throw new HttpError(502, `Cover download failed with status ${response.status}`);
  if (!response.headers.get("content-type")?.startsWith("image/")) throw new HttpError(400, "Cover URL is not an image");
  if (Number(response.headers.get("content-length")) > MAX_COVER_BYTES) throw new HttpError(400, COVER_TOO_LARGE);
  return readCapped(response.body);
}

async function prepareCover(
  source: CoverSource,
  upload: File | null,
  cropSquare: boolean,
  workDir: string,
): Promise<string | null> {
  const input = join(workDir, "cover-source");
  if (source.kind === "upload") {
    if (!upload) throw new HttpError(400, "Missing cover upload");
    await Bun.write(input, upload);
  } else if (source.kind === "url") {
    const image = await downloadImage(source.url, source.whenMissing);
    if (!image) return null;
    await Bun.write(input, image);
  } else {
    const cover = await readCover(resolveAudioPath(source.path));
    if (!cover) throw new HttpError(400, "The chosen file has no cover");
    await Bun.write(input, cover.data);
  }
  const output = join(workDir, "cover.jpg");
  const crop = cropSquare ? ["-vf", "crop='min(iw,ih)':'min(iw,ih)'"] : [];
  try {
    await runFfmpeg(["-i", input, ...crop, "-frames:v", "1", "-c:v", "mjpeg", "-q:v", "2", output]);
  } catch (error) {
    throw new HttpError(400, `Cannot read cover image: ${errorMessage(error)}`);
  }
  return output;
}

async function writeAudioFile(absolute: string, tags: TagValues, coverPath: string | null): Promise<void> {
  const extension = extname(absolute);
  const temporary = join(dirname(absolute), `.${basename(absolute, extension)}.tubetag${extension}`);
  const args = ["-i", absolute];
  if (coverPath) args.push("-i", coverPath, "-map", "0:a", "-map", "1:v", "-disposition:v:0", "attached_pic");
  else args.push("-map", "0:a", "-map", "0:v?");
  args.push("-c", "copy");
  for (const field of TAG_FIELDS) {
    const value = tags[field];
    if (value !== undefined) args.push("-metadata", `${FFMPEG_KEYS[field]}=${value}`);
  }
  args.push(temporary);
  try {
    await runFfmpeg(args);
    await rename(temporary, absolute);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

function parseTagValues(value: unknown): TagValues {
  if (!isRecord(value)) throw new HttpError(400, "Invalid tags");
  const tags: TagValues = {};
  for (const [key, raw] of Object.entries(value)) {
    const field = TAG_FIELDS.find((candidate) => candidate === key);
    if (!field) throw new HttpError(400, `Unknown tag ${key}`);
    const text = readString(raw, field, 1000);
    if (/[\u0000-\u001f]/.test(text)) throw new HttpError(400, `Invalid characters in ${field}`);
    if (field === "track" && !/^(\d+(\/\d+)?)?$/.test(text)) throw new HttpError(400, "Track must look like 3 or 3/12");
    tags[field] = text.trim();
  }
  return tags;
}

function parseCoverSource(value: unknown): CoverSource | null {
  if (value === null) return null;
  if (!isRecord(value)) throw new HttpError(400, "Invalid cover");
  if (value.kind === "upload") return { kind: "upload" };
  if (value.kind === "url") {
    const whenMissing = value.whenMissing;
    if (whenMissing !== "skip" && whenMissing !== "fail") throw new HttpError(400, "Invalid cover option");
    return { kind: "url", url: readString(value.url, "cover URL", 4096), whenMissing };
  }
  if (value.kind === "file") return { kind: "file", path: readString(value.path, "cover path", 4096) };
  throw new HttpError(400, "Invalid cover");
}

export function parseWriteTagsRequest(value: unknown): WriteTagsRequest {
  if (!isRecord(value) || !Array.isArray(value.edits) || value.edits.length === 0 || value.edits.length > MAX_BATCH_FILES) {
    throw new HttpError(400, "Invalid tag request");
  }
  const edits = value.edits.map((edit) => {
    if (!isRecord(edit)) throw new HttpError(400, "Invalid edit");
    return { path: readString(edit.path, "path", 4096), tags: parseTagValues(edit.tags) };
  });
  if (new Set(edits.map((edit) => edit.path)).size !== edits.length) throw new HttpError(400, "Duplicate paths");
  if (typeof value.cropSquare !== "boolean") throw new HttpError(400, "Invalid crop option");
  return { edits, cover: parseCoverSource(value.cover), cropSquare: value.cropSquare };
}

export async function writeTags(request: WriteTagsRequest, upload: File | null): Promise<WriteResult[]> {
  if (upload && upload.size > MAX_COVER_BYTES) throw new HttpError(400, COVER_TOO_LARGE);
  const targets = request.edits.map((edit) => ({ ...edit, absolute: resolveAudioPath(edit.path) }));
  const workDir = await mkdtemp(join(tmpdir(), "tubetag-"));
  try {
    const coverPath = request.cover ? await prepareCover(request.cover, upload, request.cropSquare, workDir) : null;
    const results: WriteResult[] = [];
    for (const target of targets) {
      try {
        await writeAudioFile(target.absolute, target.tags, coverPath);
        results.push({ path: target.path, error: null });
      } catch (error) {
        results.push({ path: target.path, error: errorMessage(error) });
      }
    }
    return results;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
