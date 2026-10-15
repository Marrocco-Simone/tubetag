import { appendFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { isMix, MIX_ITEM_LIMIT } from "../shared/helpers.ts";
import type { Job, JobKind } from "../shared/types.ts";
import { archivePath, getSettings, resolveLibraryPath } from "./settings.ts";

export type DownloadUpdate = Partial<Pick<Job, "title" | "progress" | "itemIndex" | "itemCount" | "files">>;
export type DownloadResult = { error: string | null; failedIds: string[]; folder: string | null };
export type PlaylistEntry = { index: number | null; id: string; title: string | null };

const PROGRESS_PREFIX = "tubetag-progress ";
const FILE_PREFIX = "tubetag-file ";
const FOLDER_PREFIX = "tubetag-folder ";
const PROGRESS_TEMPLATE = `download:${PROGRESS_PREFIX}%(progress.downloaded_bytes)s %(progress.total_bytes,progress.total_bytes_estimate)s %(info.playlist_index)s %(info.playlist_count,info.n_entries)s %(info.title)s`;
const FAILED_VIDEO_ERROR = /^ERROR: \[youtube\] ([\w-]{11}): /;
const UNKNOWN_TITLES = new Set(["NA", "[Deleted video]", "[Private video]"]);
const JS_RUNTIME_ARGS = ["--no-js-runtimes", "--js-runtimes", `bun:${process.execPath}`];
// yt-dlp runs process.execPath as its JS runtime; BUN_BE_BUN makes a compiled tubetag executable act as the bun CLI.
const YTDLP_ENV = { ...process.env, BUN_BE_BUN: "1" };
// limit: yt-dlp skips ThumbnailsConvertor when the thumbnail already is jpg, so such covers stay uncropped.
const SQUARE_THUMBNAIL_ARGS = `ThumbnailsConvertor+FFmpeg_o:-c:v mjpeg -vf crop="'if(gt(ih,iw),iw,ih)':'if(gt(iw,ih),ih,iw)'"`;

function mixLimitArgs(url: string): string[] {
  return isMix(url) ? ["--playlist-items", `1-${MIX_ITEM_LIMIT}`] : [];
}

function isSafeFolder(folder: string): boolean {
  try {
    resolveLibraryPath(folder);
    return true;
  } catch {
    return false;
  }
}

export function escapeOutputTemplate(text: string): string {
  return text.replaceAll("%", "%%");
}

export async function recordInArchive(videoId: string): Promise<void> {
  const file = Bun.file(archivePath);
  const line = `youtube ${videoId}`;
  const content = (await file.exists()) ? await file.text() : "";
  if (content.split("\n").includes(line)) return;
  await appendFile(archivePath, `${content && !content.endsWith("\n") ? "\n" : ""}${line}\n`);
}

type BuildOptions = { outputDir: string; tempDir: string; squareCover: boolean; fixedOutput: string | null };

function buildArgs(url: string, kind: JobKind, { outputDir, tempDir, squareCover, fixedOutput }: BuildOptions): string[] {
  const args = [
    "-f", "bestaudio[ext=m4a]/bestaudio",
    "-x", "--audio-format", "m4a",
    "--embed-thumbnail", "--convert-thumbnails", "jpg",
    "--embed-metadata",
    ...JS_RUNTIME_ARGS,
    "--newline", "--progress",
    "--progress-template", PROGRESS_TEMPLATE,
    "--print", `after_move:${FILE_PREFIX}%(filepath)s`,
    "-P", outputDir,
    "-P", `temp:${tempDir}`,
  ];
  if (squareCover) args.push("--ppa", SQUARE_THUMBNAIL_ARGS);
  if (fixedOutput) {
    args.push("--no-playlist", "-o", fixedOutput);
  } else if (kind === "playlist") {
    args.push(
      "--download-archive", archivePath,
      "-o", "%(playlist_title)s/%(playlist_index)03d - %(title)s.%(ext)s",
      "--print", `pre_process:${FOLDER_PREFIX}%(playlist_title)S`,
      "--print", `playlist:${FOLDER_PREFIX}%(title)S`,
      "--parse-metadata", "playlist_title:%(album)s",
      "--parse-metadata", "playlist_index:%(track_number)s",
      ...mixLimitArgs(url),
    );
  } else {
    args.push("--download-archive", archivePath, "--no-playlist", "-o", "Singles/%(title)s [%(id)s].%(ext)s");
  }
  args.push("--", url);
  return args;
}

function toCount(value: string | undefined): number | null {
  const count = Number(value);
  return Number.isInteger(count) && count > 0 ? count : null;
}

function parseProgress(line: string): DownloadUpdate {
  const [downloaded, total, index, count, ...title] = line.slice(PROGRESS_PREFIX.length).split(" ");
  const percent = (Number(downloaded) / Number(total)) * 100;
  return {
    progress: Number.isFinite(percent) ? Math.min(100, percent) : 0,
    itemIndex: toCount(index),
    itemCount: toCount(count),
    title: title.join(" ") || null,
  };
}

async function readLines(stream: ReadableStream<Uint8Array>, onLine: (line: string) => void): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split(/\r\n|\r|\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) if (line) onLine(line);
  }
  if (buffer) onLine(buffer);
}

// fixedOutput downloads one video to that output template and neither reads nor writes the download archive.
export async function runYtDlp(
  url: string,
  kind: JobKind,
  onUpdate: (update: DownloadUpdate) => void,
  fixedOutput: string | null = null,
): Promise<DownloadResult> {
  const { outputDir, squareCover } = getSettings();
  const files: string[] = [];
  const errors: string[] = [];
  const failedIds: string[] = [];
  let folder: string | null = null;
  // Intermediate files (thumbnails, partial downloads) go to a folder of this job, so a failed download leaves nothing in the library.
  const tempDir = await mkdtemp(join(tmpdir(), "tubetag-ytdlp-"));
  try {
    const proc = Bun.spawn(["yt-dlp", ...buildArgs(url, kind, { outputDir, tempDir, squareCover, fixedOutput })], {
      env: YTDLP_ENV,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const onLine = (line: string) => {
      if (line.startsWith(PROGRESS_PREFIX)) return onUpdate(parseProgress(line));
      console.log(`[yt-dlp] ${line}`);
      if (line.startsWith(FILE_PREFIX)) {
        files.push(relative(outputDir, line.slice(FILE_PREFIX.length)));
        return onUpdate({ files: [...files], progress: 100 });
      }
      if (line.startsWith(FOLDER_PREFIX)) {
        const name = line.slice(FOLDER_PREFIX.length);
        if (isSafeFolder(name)) folder = name;
        else {
          errors.push(`The playlist title “${name}” is not a safe folder name`);
          proc.kill();
        }
        return;
      }
      if (!line.startsWith("ERROR:")) return;
      errors.push(line.slice("ERROR:".length).trim());
      const failedId = line.match(FAILED_VIDEO_ERROR)?.[1];
      if (failedId) failedIds.push(failedId);
    };
    const [exitCode] = await Promise.all([proc.exited, readLines(proc.stdout, onLine), readLines(proc.stderr, onLine)]);
    const error = exitCode === 0 ? null : errors.join("\n") || `yt-dlp exited with code ${exitCode}`;
    return { error, failedIds, folder };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function parseEntry(line: string): PlaylistEntry | null {
  const [index, id, ...title] = line.split("\t");
  if (!id) return null;
  const text = title.join("\t");
  return { index: toCount(index), id, title: UNKNOWN_TITLES.has(text) || !text ? null : text };
}

export async function listPlaylistEntries(url: string): Promise<PlaylistEntry[]> {
  const proc = Bun.spawn(
    [
      "yt-dlp",
      "--flat-playlist",
      ...JS_RUNTIME_ARGS,
      ...mixLimitArgs(url),
      "--print", "%(playlist_index)s\t%(id)s\t%(title)s",
      "--", url,
    ],
    { env: YTDLP_ENV, stdin: "ignore", stdout: "pipe", stderr: "ignore" },
  );
  const [output, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  if (exitCode !== 0) throw new Error(`yt-dlp could not list the playlist (exit code ${exitCode})`);
  return output.split("\n").flatMap((line) => parseEntry(line) ?? []);
}
