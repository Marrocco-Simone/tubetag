import indexHtml from "../web/index.html";
import type { ServerEvent } from "../shared/types.ts";
import { audioResponse } from "./audio.ts";
import { CLIPBOARD_COMMAND, normalizeYoutubeUrl, startClipboardWatcher } from "./clipboard.ts";
import { errorResponse, HttpError, isRecord, readJson, readString } from "./http.ts";
import { parseSearchType, searchMusicBrainz } from "./musicbrainz.ts";
import {
  armReplacement,
  disarmReplacement,
  enqueue,
  getArmed,
  listJobs,
  resolveChoice,
  setPublisher,
} from "./queue.ts";
import { applyRename, planRename } from "./rename.ts";
import { getSettings, loadSettings, updateSettings } from "./settings.ts";
import { parseWriteTagsRequest, readCover, resolveAudioPath, scanLibrary, writeTags } from "./tags.ts";

declare global {
  var tubetagBrowserOpened: true | undefined;
}

const PORT = 4317;
const EVENTS_TOPIC = "events";
const ALLOWED_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);

function installHint(): string {
  if (process.platform === "darwin") return "brew install yt-dlp ffmpeg";
  if (process.platform === "win32") return "winget install yt-dlp.yt-dlp Gyan.FFmpeg";
  const clipboardPackage = process.env.WAYLAND_DISPLAY ? "wl-clipboard" : "xclip";
  return [
    "pipx install yt-dlp",
    `Debian/Ubuntu: sudo apt install ffmpeg ${clipboardPackage}`,
    `Fedora: sudo dnf install ffmpeg ${clipboardPackage}`,
    `Arch: sudo pacman -S ffmpeg ${clipboardPackage}`,
  ].join("\n  ");
}

function checkDependencies(): void {
  const missing = ["yt-dlp", "ffmpeg", "ffprobe", CLIPBOARD_COMMAND[0]].filter((name) => !Bun.which(name));
  if (missing.length === 0) return;
  console.error(`tubetag needs these programs on your PATH: ${missing.join(", ")}`);
  console.error(`Install them with:\n  ${installHint()}`);
  process.exit(1);
}

function openBrowser(url: string): void {
  const command =
    process.platform === "darwin" ? ["open"] : process.platform === "win32" ? ["cmd", "/c", "start", ""] : ["xdg-open"];
  Bun.spawn([...command, url], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
}

function assertLocalRequest(req: Request): void {
  const host = req.headers.get("host");
  const origin = req.headers.get("origin");
  if (!host || !ALLOWED_HOSTS.has(host) || (origin !== null && origin !== `http://${host}`)) {
    throw new HttpError(403, "Forbidden");
  }
}

function publish(event: ServerEvent): void {
  server.publish(EVENTS_TOPIC, JSON.stringify(event));
}

async function readTagsForm(req: Request) {
  const form = await req.formData().catch(() => {
    throw new HttpError(400, "Invalid form data");
  });
  const raw = form.get("request");
  if (typeof raw !== "string") throw new HttpError(400, "Missing request");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "Invalid request JSON");
  }
  const cover = form.get("cover");
  return { request: parseWriteTagsRequest(parsed), upload: cover instanceof File ? cover : null };
}

type ApiHandler = (req: Request, url: URL) => Response | Promise<Response>;

const api: Record<string, ApiHandler> = {
  "GET /api/settings": () => Response.json(getSettings()),
  "PUT /api/settings": async (req) => {
    const previousOutputDir = getSettings().outputDir;
    const settings = await updateSettings(await readJson(req));
    if (settings.outputDir !== previousOutputDir) publish({ type: "library" });
    return Response.json(settings);
  },
  "POST /api/jobs": async (req) => {
    const body = await readJson(req);
    const target = normalizeYoutubeUrl(isRecord(body) ? readString(body.url, "URL", 4096) : "");
    if (!target) throw new HttpError(400, "Not a YouTube video or playlist URL");
    const job = enqueue(target, "manual");
    if (!job) throw new HttpError(409, "This URL is already in the queue");
    return Response.json(job, { status: 201 });
  },
  "POST /api/jobs/choice": async (req) => {
    const body = await readJson(req);
    if (!isRecord(body)) throw new HttpError(400, "Invalid choice request");
    return Response.json(resolveChoice(readString(body.id, "job id", 100), body.choice));
  },
  "POST /api/replacement": async (req) => Response.json(await armReplacement(await readJson(req))),
  "DELETE /api/replacement": () => Response.json(disarmReplacement()),
  "GET /api/library": async () => Response.json(await scanLibrary()),
  "GET /api/cover": async (_req, url) => {
    const cover = await readCover(resolveAudioPath(url.searchParams.get("path")));
    if (!cover) throw new HttpError(404, "No cover");
    return new Response(new Uint8Array(cover.data), {
      headers: { "Content-Type": cover.format, "Cache-Control": "private, max-age=31536000, immutable" },
    });
  },
  "GET /api/audio": (req, url) => audioResponse(req, resolveAudioPath(url.searchParams.get("path"))),
  "POST /api/tags": async (req) => {
    const { request, upload } = await readTagsForm(req);
    const results = await writeTags(request, upload);
    publish({ type: "library" });
    return Response.json(results);
  },
  "POST /api/rename/preview": async (req) => Response.json(await planRename(await readJson(req))),
  "POST /api/rename/apply": async (req) => {
    const items = await applyRename(await readJson(req));
    publish({ type: "library" });
    return Response.json(items);
  },
  "GET /api/musicbrainz": async (_req, url) => {
    const type = parseSearchType(url.searchParams.get("type"));
    return Response.json(await searchMusicBrainz(type, url.searchParams.get("q") ?? ""));
  },
};

checkDependencies();
await loadSettings();

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  development: process.env.NODE_ENV !== "production",
  routes: { "/": indexHtml },
  fetch(req, server) {
    assertLocalRequest(req);
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      if (server.upgrade(req)) return;
      throw new HttpError(400, "WebSocket upgrade failed");
    }
    const handler = api[`${req.method} ${url.pathname}`];
    if (!handler) throw new HttpError(404, "Not found");
    return handler(req, url);
  },
  websocket: {
    open(ws) {
      ws.subscribe(EVENTS_TOPIC);
      const snapshot: ServerEvent[] = [
        { type: "jobs", jobs: listJobs() },
        { type: "armed", armed: getArmed() },
      ];
      for (const event of snapshot) ws.send(JSON.stringify(event));
    },
    message() {},
  },
  error: errorResponse,
});

setPublisher(publish);
startClipboardWatcher();

const appUrl = `http://127.0.0.1:${PORT}`;
console.log(`tubetag is running at ${appUrl}`);
// bun --hot re-evaluates this module on every change but keeps globalThis.
if (!globalThis.tubetagBrowserOpened) {
  globalThis.tubetagBrowserOpened = true;
  openBrowser(appUrl);
}
