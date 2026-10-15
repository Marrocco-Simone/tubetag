import { join } from "node:path";
import type { MissingSong } from "../shared/types.ts";
import { errorMessage } from "../shared/helpers.ts";
import { isRecord } from "./http.ts";
import { dataDir } from "./settings.ts";
import { listPlaylistEntries } from "./ytdlp.ts";

type MissingByFolder = Record<string, MissingSong[]>;

function toMissingSong(value: unknown): MissingSong | null {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  const index = typeof value.index === "number" && Number.isInteger(value.index) ? value.index : null;
  const title = typeof value.title === "string" ? value.title : null;
  return { id: value.id, index, title };
}

function toMissingByFolder(data: unknown): MissingByFolder {
  if (!isRecord(data)) return {};
  const result: MissingByFolder = {};
  for (const [folder, songs] of Object.entries(data)) {
    if (!Array.isArray(songs)) continue;
    const valid = songs.flatMap((song) => toMissingSong(song) ?? []);
    if (valid.length > 0) result[folder] = valid;
  }
  return result;
}

const missingPath = join(dataDir, "missing.json");

export async function readMissing(): Promise<MissingByFolder> {
  const file = Bun.file(missingPath);
  if (!(await file.exists())) return {};
  try {
    return toMissingByFolder(await file.json());
  } catch (error) {
    console.warn(`Ignoring invalid ${missingPath}:`, errorMessage(error));
    return {};
  }
}

export async function saveMissing(folder: string, songs: MissingSong[]): Promise<void> {
  const all = await readMissing();
  if (songs.length > 0) all[folder] = songs;
  else delete all[folder];
  await Bun.write(missingPath, JSON.stringify(all, null, 2));
}

export async function removeMissing(folder: string, id: string): Promise<void> {
  const songs = (await readMissing())[folder] ?? [];
  await saveMissing(folder, songs.filter((song) => song.id !== id));
}

// limit: titles come from one extra flat-playlist request per playlist job with errors; if that request fails, only the IDs are known.
export async function describeMissing(playlistUrl: string, failedIds: string[]): Promise<MissingSong[]> {
  try {
    const byId = new Map((await listPlaylistEntries(playlistUrl)).map((entry) => [entry.id, entry]));
    return failedIds.map((id) => byId.get(id) ?? { id, index: null, title: null });
  } catch (error) {
    console.warn("Cannot list the playlist for missing songs:", errorMessage(error));
    return failedIds.map((id) => ({ id, index: null, title: null }));
  }
}
