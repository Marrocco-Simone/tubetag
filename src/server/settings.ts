import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Settings } from "../shared/types.ts";
import { HttpError, isRecord } from "./http.ts";

function resolveDataDir(): string {
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "tubetag");
  if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    if (!appData) throw new Error("APPDATA is not set");
    return join(appData, "tubetag");
  }
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "tubetag");
}

export const dataDir = resolveDataDir();
export const archivePath = join(dataDir, "archive.txt");
const settingsPath = join(dataDir, "settings.json");

let current: Settings = {
  outputDir: join(homedir(), "Music", "tubetag"),
  clipboardWatch: "running",
  squareCover: true,
  musicbrainzContact: "",
};

export function getSettings(): Settings {
  return current;
}

function mergeSettings(base: Settings, input: unknown): Settings {
  if (!isRecord(input)) throw new HttpError(400, "Settings must be an object");
  const next = { ...base };
  if (input.outputDir !== undefined) {
    if (typeof input.outputDir !== "string" || !isAbsolute(input.outputDir)) {
      throw new HttpError(400, "Output folder must be an absolute path");
    }
    next.outputDir = resolve(input.outputDir);
  }
  if (input.clipboardWatch !== undefined) {
    if (input.clipboardWatch !== "running" && input.clipboardWatch !== "paused") {
      throw new HttpError(400, "Invalid clipboard watch status");
    }
    next.clipboardWatch = input.clipboardWatch;
  }
  if (input.squareCover !== undefined) {
    if (typeof input.squareCover !== "boolean") throw new HttpError(400, "Invalid square cover option");
    next.squareCover = input.squareCover;
  }
  if (input.musicbrainzContact !== undefined) {
    if (typeof input.musicbrainzContact !== "string" || !/^[^\r\n()]{0,200}$/.test(input.musicbrainzContact)) {
      throw new HttpError(400, "Invalid MusicBrainz contact");
    }
    next.musicbrainzContact = input.musicbrainzContact.trim();
  }
  return next;
}

export async function loadSettings(): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  const file = Bun.file(settingsPath);
  if (await file.exists()) {
    try {
      current = mergeSettings(current, await file.json());
    } catch (error) {
      console.warn(`Ignoring invalid ${settingsPath}:`, error);
    }
  }
  await mkdir(current.outputDir, { recursive: true });
}

export async function updateSettings(input: unknown): Promise<Settings> {
  const next = mergeSettings(current, input);
  await mkdir(next.outputDir, { recursive: true });
  await Bun.write(settingsPath, JSON.stringify(next, null, 2));
  current = next;
  return current;
}

export function resolveLibraryPath(path: unknown): string {
  if (typeof path !== "string" || path === "") throw new HttpError(400, "Invalid path");
  const root = current.outputDir;
  const absolute = resolve(root, path);
  const fromRoot = relative(root, absolute);
  if (fromRoot === "" || fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new HttpError(400, "Path is outside the output folder");
  }
  return absolute;
}
