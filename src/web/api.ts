import type {
  ArmedReplacement,
  Job,
  JobChoice,
  Library,
  MbCandidate,
  MbSearchType,
  RenameItem,
  RenameRequest,
  Settings,
  Track,
  WriteResult,
  WriteTagsRequest,
} from "../shared/types.ts";

function hasErrorMessage(body: unknown): body is { error: string } {
  return typeof body === "object" && body !== null && "error" in body && typeof body.error === "string";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(hasErrorMessage(body) ? body.error : `Request failed with status ${response.status}`);
  return body as T;
}

function jsonBody(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

export function coverUrl(track: Track): string {
  return `/api/cover?${new URLSearchParams({ path: track.path, v: String(track.mtime) })}`;
}

export const api = {
  settings: () => request<Settings>("/api/settings"),
  updateSettings: (patch: Partial<Settings>) => request<Settings>("/api/settings", jsonBody("PUT", patch)),
  addJob: (url: string) => request<Job>("/api/jobs", jsonBody("POST", { url })),
  chooseJob: (id: string, choice: JobChoice) => request<Job | null>("/api/jobs/choice", jsonBody("POST", { id, choice })),
  library: () => request<Library>("/api/library"),
  armReplacement: (folder: string, id: string) =>
    request<ArmedReplacement>("/api/replacement", jsonBody("POST", { folder, id })),
  disarmReplacement: () => request<null>("/api/replacement", { method: "DELETE" }),
  writeTags: (body: WriteTagsRequest, upload: File | null) => {
    const form = new FormData();
    form.append("request", JSON.stringify(body));
    if (upload) form.append("cover", upload);
    return request<WriteResult[]>("/api/tags", { method: "POST", body: form });
  },
  previewRename: (body: RenameRequest) => request<RenameItem[]>("/api/rename/preview", jsonBody("POST", body)),
  applyRename: (body: RenameRequest) => request<RenameItem[]>("/api/rename/apply", jsonBody("POST", body)),
  searchMusicBrainz: (type: MbSearchType, q: string) =>
    request<MbCandidate[]>(`/api/musicbrainz?${new URLSearchParams({ type, q })}`),
};
