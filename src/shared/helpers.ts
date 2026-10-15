// YouTube generates mixes (list=RD…) without an end; the first 25 match what the YouTube player shows.
export const MIX_ITEM_LIMIT = 25;

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function playlistId(url: string | null): string | null {
  return URL.parse(url ?? "")?.searchParams.get("list") ?? null;
}

export function isMix(url: string | null): boolean {
  return playlistId(url)?.startsWith("RD") ?? false;
}
