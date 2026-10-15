import { enqueue, type DownloadTarget } from "./queue.ts";
import { getSettings } from "./settings.ts";

declare global {
  var tubetagClipboardTimer: Timer | undefined;
}

const VIDEO_ID = /^[\w-]{11}$/;
const LIST_ID = /^[\w-]+$/;
const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"]);

function clipboardCommand(): [string, ...string[]] {
  if (process.platform === "darwin") return ["pbpaste"];
  // limit: spawns one powershell process per second; a native clipboard listener would avoid the polling cost.
  if (process.platform === "win32") return ["powershell", "-NoProfile", "-Command", "Get-Clipboard"];
  return process.env.WAYLAND_DISPLAY ? ["wl-paste", "--no-newline"] : ["xclip", "-selection", "clipboard", "-o"];
}

export const CLIPBOARD_COMMAND = clipboardCommand();

function videoTarget(origin: string, videoId: string, listId: string | null): DownloadTarget {
  const url = `${origin}/watch?v=${videoId}`;
  const playlistUrl = listId && LIST_ID.test(listId) ? `${url}&list=${listId}` : null;
  return { url, kind: "video", playlistUrl };
}

export function normalizeYoutubeUrl(raw: string): DownloadTarget | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  const listId = url.searchParams.get("list");
  if (host === "youtu.be") {
    const id = url.pathname.slice(1);
    return VIDEO_ID.test(id) ? videoTarget("https://www.youtube.com", id, listId) : null;
  }
  if (!YOUTUBE_HOSTS.has(host)) return null;
  const origin = host === "music.youtube.com" ? "https://music.youtube.com" : "https://www.youtube.com";
  const shortsId = url.pathname.match(/^\/shorts\/([\w-]{11})\/?$/)?.[1];
  if (shortsId) return videoTarget("https://www.youtube.com", shortsId, null);
  const videoId = url.searchParams.get("v");
  if (url.pathname === "/watch" && videoId && VIDEO_ID.test(videoId)) return videoTarget(origin, videoId, listId);
  if ((url.pathname === "/playlist" || url.pathname === "/watch") && listId && LIST_ID.test(listId)) {
    return { url: `${origin}/playlist?list=${listId}`, kind: "playlist", playlistUrl: null };
  }
  return null;
}

async function readClipboard(): Promise<string> {
  const proc = Bun.spawn(CLIPBOARD_COMMAND, { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
  const [text, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return exitCode === 0 ? text.trim() : "";
}

let lastContent: string | null = null;
let reading = false;

async function poll(): Promise<void> {
  if (getSettings().clipboardWatch === "paused") {
    lastContent = null;
    return;
  }
  const content = await readClipboard();
  if (content === lastContent) return;
  const isBaseline = lastContent === null;
  lastContent = content;
  if (isBaseline) return;
  for (const token of content.split(/\s+/)) {
    const target = normalizeYoutubeUrl(token);
    if (target) enqueue(target, "clipboard");
  }
}

export function startClipboardWatcher(): void {
  // bun --hot re-evaluates modules but keeps globalThis, so the poller of the previous evaluation stops here.
  clearInterval(globalThis.tubetagClipboardTimer);
  globalThis.tubetagClipboardTimer = setInterval(() => {
    if (reading) return;
    reading = true;
    poll()
      .catch((error) => console.error("Clipboard read failed:", error))
      .finally(() => {
        reading = false;
      });
  }, 1000);
}
