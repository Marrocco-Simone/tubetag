import { basename, extname, join } from "node:path";
import type { ArmedReplacement, Job, TagValues } from "../shared/types.ts";
import { removeMissing } from "./missing.ts";
import { moveWithoutOverwrite, sanitizeFileName } from "./rename.ts";
import { resolveLibraryPath } from "./settings.ts";
import { scanLibrary, writeTags } from "./tags.ts";
import { escapeOutputTemplate, recordInArchive, runYtDlp, type DownloadUpdate } from "./ytdlp.ts";

export type ReplacementResult = { path: string; title: string | null };

function indexPrefix(index: number | null): string {
  return index === null ? "" : `${String(index).padStart(3, "0")} - `;
}

async function download(
  job: Job,
  folder: string,
  index: number | null,
  onUpdate: (update: DownloadUpdate) => void,
): Promise<string> {
  resolveLibraryPath(folder);
  const saved: string[] = [];
  const output = `${escapeOutputTemplate(folder)}/${indexPrefix(index)}%(title)s.%(ext)s`;
  const result = await runYtDlp(
    job.url,
    "video",
    (update) => {
      if (update.files) saved.push(...update.files.slice(saved.length));
      onUpdate(update);
    },
    output,
  );
  if (result.error) throw new Error(result.error);
  const path = saved.at(-1);
  if (!path) throw new Error("yt-dlp finished without saving a file");
  return path;
}

export async function runReplacement(
  job: Job,
  { folder, song }: ArmedReplacement,
  onUpdate: (update: DownloadUpdate) => void,
): Promise<ReplacementResult> {
  const videoId = URL.parse(job.url)?.searchParams.get("v");
  if (!videoId) throw new Error("The link has no video ID");
  const { tracks } = await scanLibrary();
  const album = tracks.find((track) => track.folder === folder && track.album)?.album ?? basename(folder);
  const existing = tracks.find((track) => track.videoId === videoId);
  let result: ReplacementResult;
  if (existing) {
    const name = sanitizeFileName(
      `${indexPrefix(song.index)}${existing.title ?? basename(existing.name, extname(existing.name))}`,
    );
    const path = join(folder, name + extname(existing.path));
    await moveWithoutOverwrite(resolveLibraryPath(existing.path), resolveLibraryPath(path));
    result = { path, title: existing.title };
  } else {
    const path = await download(job, folder, song.index, onUpdate);
    await recordInArchive(videoId);
    result = { path, title: job.title };
  }
  const tags: TagValues = song.index === null ? { album } : { album, track: String(song.index) };
  const [written] = await writeTags({ edits: [{ path: result.path, tags }], cover: null, cropSquare: false }, null);
  if (written?.error) throw new Error(`The file is in place, but its tags were not written: ${written.error}`);
  await removeMissing(folder, song.id);
  return result;
}
