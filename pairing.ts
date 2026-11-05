// Desktop Monitor pairing helpers (pure, browser-safe).
export const PUBLISHED_ORIGIN = "https://lensprompt-irshad-2026.lovable.app";
export const PEER_PREFIX = "lensprompt-mon-";

/** Random, unguessable session ID (call from effects/handlers only). */
export function makeSessionId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 20);
}

/** The private editor preview needs a Lovable login, so phones get the public published site. */
export function publicOrigin(origin: string): string {
  if (!origin.startsWith("https://") || origin.includes("id-preview--") || origin.includes("lovableproject.com")) {
    return PUBLISHED_ORIGIN;
  }
  return origin;
}

export function buildPairUrl(origin: string, session: string): string {
  return `${publicOrigin(origin)}/pair?session=${encodeURIComponent(session)}`;
}

export function isValidSession(s: unknown): s is string {
  return typeof s === "string" && /^[a-z0-9]{12,32}$/.test(s);
}

/** Desktop may only say "Streaming live" once the remote track is live, unmuted, decoded and playing. */
export function isVideoLive(v: { trackState?: string; muted?: boolean; videoWidth: number; paused: boolean }): boolean {
  return v.trackState === "live" && v.muted === false && v.videoWidth > 0 && !v.paused;
}

/** Phone may only say "Streaming live" once real video bytes are leaving the device. */
export function isSendingVideo(prevBytes: number, bytes: number): boolean {
  return bytes > prevBytes;
}
