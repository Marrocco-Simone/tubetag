import { rename, stat } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { errorMessage } from "../shared/helpers.ts";
import type { RenameItem, Track } from "../shared/types.ts";
import { HttpError, isRecord, readPaths, readString } from "./http.ts";
import { resolveLibraryPath } from "./settings.ts";
import { readTrack, resolveAudioPath } from "./tags.ts";

const MAX_NAME_BYTES = 200;
const INVALID_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f]/g;
const RESERVED_WINDOWS_NAMES = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;
const TOKENS: Record<string, (track: Track) => string | null> = {
  album: (track) => track.album,
  title: (track) => track.title,
  artist: (track) => track.artist,
  albumartist: (track) => track.albumartist,
  track: (track) => (track.track === null ? null : String(track.track).padStart(2, "0")),
  year: (track) => track.year,
};

export function sanitizeFileName(name: string): string {
  const clean = name.replace(INVALID_CHARACTERS, "_").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "");
  const characters = Array.from(RESERVED_WINDOWS_NAMES.test(clean) ? `_${clean}` : clean);
  while (Buffer.byteLength(characters.join("")) > MAX_NAME_BYTES) characters.pop();
  return characters.join("").trimEnd();
}

function renderPattern(pattern: string, track: Track): string {
  return pattern.replace(/\{(\w+)\}/g, (match, token: string) => {
    const read = TOKENS[token];
    return read ? (read(track) ?? "") : match;
  });
}

async function isTakenByOtherFile(from: string, to: string): Promise<boolean> {
  const target = await stat(to).catch(() => null);
  if (!target) return false;
  const source = await stat(from);
  return source.ino !== target.ino || source.dev !== target.dev;
}

export async function moveWithoutOverwrite(from: string, to: string): Promise<void> {
  if (from === to) return;
  if (await isTakenByOtherFile(from, to)) throw new Error(`${basename(to)} already exists`);
  await rename(from, to);
}

function parseRenameRequest(value: unknown): { paths: string[]; pattern: string } {
  if (!isRecord(value)) throw new HttpError(400, "Invalid rename request");
  const pattern = readString(value.pattern, "pattern", 500);
  if (!pattern.trim()) throw new HttpError(400, "Pattern is empty");
  return { paths: readPaths(value.paths), pattern };
}

export async function planRename(input: unknown): Promise<RenameItem[]> {
  const { paths, pattern } = parseRenameRequest(input);
  const tracks = await Promise.all(paths.map((path) => readTrack(resolveAudioPath(path))));
  const items = tracks.map((track) => {
    const name = sanitizeFileName(renderPattern(pattern, track));
    const newPath = name ? join(dirname(track.path), name + extname(track.path)) : track.path;
    return { path: track.path, newPath, problem: name ? null : "Name is empty" };
  });
  const targetCounts = new Map<string, number>();
  for (const item of items) {
    const key = item.newPath.toLowerCase();
    targetCounts.set(key, (targetCounts.get(key) ?? 0) + 1);
  }
  return Promise.all(
    items.map(async (item): Promise<RenameItem> => {
      if (item.problem) return item;
      if ((targetCounts.get(item.newPath.toLowerCase()) ?? 0) > 1) return { ...item, problem: "Same name as another file" };
      const taken = await isTakenByOtherFile(resolveLibraryPath(item.path), resolveLibraryPath(item.newPath));
      return taken ? { ...item, problem: "A file with this name exists" } : item;
    }),
  );
}

export async function applyRename(input: unknown): Promise<RenameItem[]> {
  const items = await planRename(input);
  if (items.some((item) => item.problem)) throw new HttpError(409, "Resolve the name conflicts before renaming");
  const results: RenameItem[] = [];
  for (const item of items) {
    try {
      await moveWithoutOverwrite(resolveLibraryPath(item.path), resolveLibraryPath(item.newPath));
      results.push(item);
    } catch (error) {
      results.push({ ...item, newPath: item.path, problem: errorMessage(error) });
    }
  }
  return results;
}
