import type { ArmedReplacement, Job, JobChoice, JobKind, JobStatus, MissingSong, ServerEvent } from "../shared/types.ts";
import { errorMessage, playlistId } from "../shared/helpers.ts";
import { HttpError, isRecord, readString } from "./http.ts";
import { describeMissing, readMissing, saveMissing } from "./missing.ts";
import { runReplacement } from "./replace.ts";
import { resolveLibraryPath } from "./settings.ts";
import { runYtDlp, type DownloadResult } from "./ytdlp.ts";

export type DownloadTarget = { url: string; kind: JobKind; playlistUrl: string | null };

type QueueState = { jobs: Job[]; seenUrls: Set<string>; running: boolean; armed: ArmedReplacement | null };

declare global {
  var tubetagQueue: QueueState | undefined;
}

const ACTIVE_STATUSES: ReadonlySet<JobStatus> = new Set(["awaiting-choice", "queued", "downloading"]);
const LIBRARY_REFRESH_INTERVAL_MS = 1500;

// bun --hot re-evaluates modules but keeps globalThis, so jobs, seen links, the running flag and the armed row survive a reload.
const state = (globalThis.tubetagQueue ??= { jobs: [], seenUrls: new Set(), running: false, armed: null });
const { jobs, seenUrls } = state;
let publish: (event: ServerEvent) => void = () => {};
let libraryRefreshTimer: Timer | undefined;

export function setPublisher(publisher: (event: ServerEvent) => void): void {
  publish = publisher;
}

export function listJobs(): Job[] {
  return jobs;
}

export function getArmed(): ArmedReplacement | null {
  return state.armed;
}

function setArmed(armed: ArmedReplacement | null): void {
  state.armed = armed;
  publish({ type: "armed", armed });
}

export async function armReplacement(input: unknown): Promise<ArmedReplacement> {
  if (!isRecord(input)) throw new HttpError(400, "Invalid replacement request");
  const folder = readString(input.folder, "folder", 4096);
  resolveLibraryPath(folder);
  const id = readString(input.id, "video ID", 64);
  const song = (await readMissing())[folder]?.find((candidate) => candidate.id === id);
  if (!song) throw new HttpError(404, "This song is no longer in the not-downloaded list");
  const armed = { folder, song };
  setArmed(armed);
  return armed;
}

export function disarmReplacement(): null {
  setArmed(null);
  return null;
}

function update(job: Job, patch: Partial<Job>): void {
  Object.assign(job, patch);
  publish({ type: "job", job });
}

function scheduleLibraryRefresh(): void {
  if (libraryRefreshTimer) return;
  libraryRefreshTimer = setTimeout(() => {
    libraryRefreshTimer = undefined;
    publish({ type: "library" });
  }, LIBRARY_REFRESH_INTERVAL_MS);
}

type Link = Pick<Job, "url" | "kind" | "playlistUrl">;

function identity({ url, kind, playlistUrl }: Link): string {
  if (playlistUrl) return `choice ${url} ${playlistId(playlistUrl)}`;
  return kind === "playlist" ? `playlist ${playlistId(url)}` : `video ${url}`;
}

function linkKeys(link: Link): string[] {
  if (!link.playlistUrl) return [identity(link)];
  return [`video ${link.url}`, `playlist ${playlistId(link.playlistUrl)}`];
}

function isSameLink(job: Job, target: DownloadTarget): boolean {
  const targetKeys = linkKeys(target);
  return linkKeys(job).some((key) => targetKeys.includes(key));
}

async function fetchVideoTitle(videoUrl: string): Promise<string | null> {
  const videoId = new URL(videoUrl).searchParams.get("v");
  const query = new URLSearchParams({ url: `https://www.youtube.com/watch?v=${videoId}`, format: "json" });
  const response = await fetch(`https://www.youtube.com/oembed?${query}`, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) return null;
  const body: unknown = await response.json();
  return isRecord(body) && typeof body.title === "string" ? body.title : null;
}

function addJob(fields: Pick<Job, "url" | "kind" | "playlistUrl" | "replaces">): Job {
  const job: Job = {
    ...fields,
    id: crypto.randomUUID(),
    status: fields.playlistUrl ? "awaiting-choice" : "queued",
    title: null,
    progress: 0,
    itemIndex: null,
    itemCount: null,
    files: [],
    folder: null,
    missing: [],
    error: null,
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
  };
  jobs.push(job);
  publish({ type: "job", job });
  if (job.status === "awaiting-choice") {
    fetchVideoTitle(job.url).then(
      (title) => {
        if (title && job.title === null && jobs.includes(job)) update(job, { title });
      },
      () => {},
    );
  }
  void runNext();
  return job;
}

export function enqueue(target: DownloadTarget, source: "clipboard" | "manual"): Job | null {
  const key = identity(target);
  const armed = state.armed;
  if (armed && target.kind === "video") {
    seenUrls.add(key);
    setArmed(null);
    return addJob({ url: target.url, kind: "video", playlistUrl: null, replaces: armed });
  }
  if (source === "clipboard") {
    if (seenUrls.has(key)) return null;
    if (jobs.some((job) => job.status !== "failed" && isSameLink(job, target))) return null;
  }
  if (jobs.some((job) => ACTIVE_STATUSES.has(job.status) && identity(job) === key)) return null;
  seenUrls.add(key);
  return addJob({ ...target, replaces: null });
}

function parseChoice(value: unknown): JobChoice {
  if (value === "video" || value === "playlist" || value === "cancel") return value;
  throw new HttpError(400, "Choice must be video, playlist or cancel");
}

export function resolveChoice(id: string, rawChoice: unknown): Job | null {
  const choice = parseChoice(rawChoice);
  const index = jobs.findIndex((job) => job.id === id && job.status === "awaiting-choice");
  const job = jobs[index];
  if (!job?.playlistUrl) throw new HttpError(404, "This link no longer waits for a choice");
  if (choice === "cancel") {
    jobs.splice(index, 1);
    publish({ type: "job-removed", id });
    return null;
  }
  const patch: Partial<Job> =
    choice === "playlist"
      ? { url: job.playlistUrl, kind: "playlist", title: null, playlistUrl: null, status: "queued" }
      : { playlistUrl: null, status: "queued" };
  update(job, patch);
  void runNext();
  return job;
}

async function recordMissing(job: Job, result: DownloadResult): Promise<MissingSong[]> {
  if (!result.folder) return [];
  const missing = result.failedIds.length > 0 ? await describeMissing(job.url, result.failedIds) : [];
  await saveMissing(result.folder, missing);
  return missing;
}

async function runDownloadJob(job: Job): Promise<void> {
  const result = await runYtDlp(job.url, job.kind, (patch) => {
    update(job, patch);
    if (patch.files) scheduleLibraryRefresh();
  });
  const missing = job.kind === "playlist" ? await recordMissing(job, result) : [];
  update(job, {
    status: result.error && job.files.length === 0 ? "failed" : "done",
    error: result.error,
    folder: result.folder,
    missing,
    finishedAt: new Date().toISOString(),
  });
}

async function runReplacementJob(job: Job, replaces: ArmedReplacement): Promise<void> {
  const { path, title } = await runReplacement(job, replaces, (patch) => update(job, patch));
  update(job, {
    status: "done",
    title: title ?? job.title,
    files: [path],
    folder: replaces.folder,
    progress: 100,
    finishedAt: new Date().toISOString(),
  });
}

// limit: one yt-dlp process at a time; parallel downloads need a worker pool with a concurrency setting.
async function runNext(): Promise<void> {
  if (state.running) return;
  const job = jobs.find((candidate) => candidate.status === "queued");
  if (!job) return;
  state.running = true;
  update(job, { status: "downloading", startedAt: new Date().toISOString() });
  try {
    if (job.replaces) await runReplacementJob(job, job.replaces);
    else await runDownloadJob(job);
  } catch (error) {
    update(job, { status: "failed", error: errorMessage(error), finishedAt: new Date().toISOString() });
  }
  publish({ type: "library" });
  state.running = false;
  void runNext();
}
