import { extname } from "node:path";
import { HttpError } from "./http.ts";

const AUDIO_TYPES: Record<string, string> = { ".m4a": "audio/mp4", ".mp3": "audio/mpeg" };
const SINGLE_RANGE = /^bytes=(\d*)-(\d*)$/;

function byteRange(header: string | null, size: number): { start: number; end: number } | "invalid" | null {
  const match = header?.trim().match(SINGLE_RANGE);
  if (!match) return null;
  const [, startText = "", endText = ""] = match;
  if (startText === "" && endText === "") return "invalid";
  if (startText === "") {
    const suffixLength = Number(endText);
    return suffixLength > 0 && size > 0 ? { start: Math.max(0, size - suffixLength), end: size - 1 } : "invalid";
  }
  const start = Number(startText);
  const end = endText === "" ? size - 1 : Math.min(Number(endText), size - 1);
  return start <= end ? { start, end } : "invalid";
}

export async function audioResponse(req: Request, absolute: string): Promise<Response> {
  const file = Bun.file(absolute);
  if (!(await file.exists())) throw new HttpError(404, "Audio file not found");
  const headers = {
    "Content-Type": AUDIO_TYPES[extname(absolute).toLowerCase()] ?? "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-cache",
  };
  const range = byteRange(req.headers.get("range"), file.size);
  if (range === null) return new Response(file, { headers });
  if (range === "invalid") {
    return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${file.size}` } });
  }
  return new Response(file.slice(range.start, range.end + 1), {
    status: 206,
    headers: {
      ...headers,
      "Content-Range": `bytes ${range.start}-${range.end}/${file.size}`,
      "Content-Length": String(range.end - range.start + 1),
    },
  });
}
