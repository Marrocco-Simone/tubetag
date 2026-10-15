import { errorMessage } from "../shared/helpers.ts";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

export function readString(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== "string" || value.length > maxLength) throw new HttpError(400, `Invalid ${name}`);
  return value;
}

export const MAX_BATCH_FILES = 5000;

export function readPaths(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_BATCH_FILES) {
    throw new HttpError(400, "Invalid paths");
  }
  const paths = value.map((path) => readString(path, "path", 4096));
  if (new Set(paths).size !== paths.length) throw new HttpError(400, "Duplicate paths");
  return paths;
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
  console.error(error);
  return Response.json({ error: errorMessage(error) }, { status: 500 });
}
