import { useEffect, useRef, useState } from "react";
import Peer from "peerjs";
import type { DataConnection, MediaConnection } from "peerjs";
import { Button } from "@/components/ui/button";
import { PEER_PREFIX, isSendingVideo, isValidSession } from "@/lib/pairing";

type Status = "ready" | "pairing" | "awaiting" | "connecting" | "live" | "reconnecting" | "ended" | "rejected" | "error";

type PairMessage =
  | { type: "pair-request" }
  | { type: "accepted" }
  | { type: "rejected" }
  | { type: "ping" }
  | { type: "pong" }
  | { type: "bye" };

const APPROVAL_TIMEOUT = 90000; // laptop never answered the request
const CALL_TIMEOUT = 20000; // a video call that never connects is retried
const DISCONNECT_GRACE = 6000; // ICE "disconnected" this long -> re-call
const MAX_RETRIES = 4;

const STEPS: { label: string; on: Status[] }[] = [
  { label: "Waiting for laptop approval", on: ["pairing", "awaiting"] },
  { label: "Camera starting", on: ["connecting"] },
  { label: "Streaming live", on: ["live"] },
  { label: "Reconnecting", on: ["reconnecting"] },
  { label: "Disconnected", on: ["ended", "rejected", "error"] },
];

async function openRearCamera(): Promise<MediaStream> {
  const size = { width: { ideal: 1280 }, height: { ideal: 720 } };
  const attempts: MediaStreamConstraints[] = [
    { video: { facingMode: { exact: "environment" }, ...size }, audio: false },
    { video: { facingMode: { ideal: "environment" }, ...size }, audio: false },
    { video: { facingMode: "environment" }, audio: false },
  ];
  let last: unknown;
  for (const c of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(c);
    } catch (e) {
      last = e;
      const name = e instanceof DOMException ? e.name : "";
      if (name === "NotAllowedError" || name === "SecurityError" || name === "NotReadableError") break; // retrying won't help
    }
  }
  throw last;
}

function cameraError(e: unknown): string {
  const name = e instanceof DOMException ? e.name : "";
  if (name === "NotAllowedError" || name === "SecurityError")
    return "Camera permission denied. In iPhone Settings → Safari → Camera choose “Allow”, then tap Try again.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No rear camera found on this device.";
  if (name === "NotReadableError") return "The camera is busy in another app. Close it and tap Try again.";
  return "Could not open the rear camera.";
}

export default function PhoneSender({ session }: { session: string }) {
  const [status, setStatus] = useState<Status>("ready");
  const [error, setError] = useState("");
  const statusRef = useRef<Status>("ready");
  const setBoth = (s: Status) => {
    statusRef.current = s;
    setStatus(s);
  };
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const peerRef = useRef<Peer | null>(null);
  const dataRef = useRef<DataConnection | null>(null);
  const callRef = useRef<MediaConnection | null>(null);
  const approvalTimerRef = useRef<number | null>(null);
  const monitorRef = useRef<number | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const retriesRef = useRef(0);
  const callStartRef = useRef(0);
  const disconnectedSinceRef = useRef(0);
  const bytesRef = useRef(0);
  const target = PEER_PREFIX + session;

  const clearTimers = () => {
    for (const r of [approvalTimerRef, retryTimerRef]) if (r.current !== null) window.clearTimeout(r.current);
    if (monitorRef.current !== null) window.clearInterval(monitorRef.current);
    approvalTimerRef.current = retryTimerRef.current = monitorRef.current = null;
  };

  const cleanup = () => {
    clearTimers();
    const call = callRef.current, data = dataRef.current, peer = peerRef.current;
    callRef.current = dataRef.current = peerRef.current = null; // null first so old handlers go stale
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    call?.close();
    data?.close();
    peer?.destroy();
    if (videoRef.current) videoRef.current.srcObject = null;
  };
  useEffect(() => cleanup, []);

  const send = (msg: PairMessage) => {
    const conn = dataRef.current;
    if (conn?.open) conn.send(msg);
  };

  const fail = (msg: string) => {
    cleanup();
    setError(msg);
    setBoth("error");
  };

  const end = () => {
    cleanup();
    setBoth("ended");
  };

  const streaming = () => ["connecting", "live", "reconnecting"].includes(statusRef.current);

  // Pairing/keepalive channel. Reopened automatically if it drops while streaming.
  const openData = (peer: Peer, first: boolean) => {
    const conn = peer.connect(target, { reliable: true });
    dataRef.current = conn;
    conn.on("open", () => {
      if (dataRef.current !== conn) return;
      if (first) {
        conn.send({ type: "pair-request" } satisfies PairMessage);
        setBoth("awaiting");
      }
    });
    conn.on("data", (raw: unknown) => {
      if (dataRef.current !== conn) return;
      const msg = raw as PairMessage;
      if (msg?.type === "accepted" && statusRef.current === "awaiting") {
        if (approvalTimerRef.current !== null) window.clearTimeout(approvalTimerRef.current);
        approvalTimerRef.current = null;
        setBoth("connecting");
        void startCamera(peer);
      } else if (msg?.type === "rejected") {
        cleanup();
        setBoth("rejected");
      } else if (msg?.type === "ping") {
        send({ type: "pong" });
      } else if (msg?.type === "bye") {
        end();
      }
    });
    conn.on("close", () => {
      if (dataRef.current !== conn) return;
      dataRef.current = null;
      if (statusRef.current === "pairing" || statusRef.current === "awaiting") {
        fail("The laptop closed this pairing request. Make a new QR code on the laptop and scan again.");
      }
      // While streaming, the monitor loop reopens the channel.
    });
  };

  const connect = () => {
    setError("");
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setBoth("error");
      setError("Camera needs a secure page. Open the https:// link from the QR code in Safari (not inside another app).");
      return;
    }
    cleanup();
    retriesRef.current = 0;
    setBoth("pairing");
    try {
      const peer = new Peer();
      peerRef.current = peer;
      approvalTimerRef.current = window.setTimeout(() => {
        if (statusRef.current === "pairing" || statusRef.current === "awaiting") {
          fail("The laptop did not respond in time. Make a new QR code on the laptop and scan again.");
        }
      }, APPROVAL_TIMEOUT);
      let opened = false;
      peer.on("open", () => {
        if (peerRef.current !== peer || opened) return; // "open" fires again after a signaling reconnect
        opened = true;
        openData(peer, true);
      });
      peer.on("disconnected", () => {
        if (peerRef.current !== peer || peer.destroyed) return;
        window.setTimeout(() => {
          if (peerRef.current === peer && peer.disconnected && !peer.destroyed) peer.reconnect();
        }, 1000);
      });
      peer.on("error", (e) => {
        if (peerRef.current !== peer) return;
        if (e.type === "peer-unavailable") {
          return fail(
            streaming()
              ? "The laptop session has closed. Make a new QR code on the laptop."
              : "Laptop session not found or expired. Make a new QR code on the laptop and scan again.",
          );
        }
        const transient = e.type === "network" || e.type === "socket-error" || e.type === "server-error" || e.type === "socket-closed";
        if (transient && streaming()) return; // reconnect + retry loop handle it
        fail(
          transient
            ? "Cannot reach the pairing server. Check the iPhone's internet connection and tap Try again."
            : e.type === "browser-incompatible"
              ? "This browser cannot send live video. Open the link in Safari."
              : `Connection error: ${e.message}`,
        );
      });
    } catch (e) {
      fail(e instanceof Error ? e.message : "Could not start pairing.");
    }
  };

  const placeCall = (peer: Peer) => {
    const stream = streamRef.current;
    if (!stream || peerRef.current !== peer) return;
    const call = peer.call(target, stream);
    if (!call) return scheduleRetry(peer);
    const old = callRef.current;
    callRef.current = call;
    old?.close();
    callStartRef.current = Date.now();
    disconnectedSinceRef.current = 0;
    bytesRef.current = 0;
    call.on("close", () => {
      if (callRef.current === call && streaming()) scheduleRetry(peer);
    });
    call.on("error", () => {
      if (callRef.current === call && streaming()) scheduleRetry(peer);
    });
  };

  const scheduleRetry = (peer: Peer) => {
    if (retryTimerRef.current !== null || peerRef.current !== peer) return;
    if (retriesRef.current >= MAX_RETRIES) {
      send({ type: "bye" });
      return fail("Could not reach the laptop. Put both devices on the same Wi-Fi, make a new QR code and try again.");
    }
    retriesRef.current += 1;
    setBoth("reconnecting");
    const c = callRef.current;
    callRef.current = null;
    c?.close();
    retryTimerRef.current = window.setTimeout(() => {
      retryTimerRef.current = null;
      if (peerRef.current !== peer) return;
      if (peer.disconnected && !peer.destroyed) peer.reconnect();
      placeCall(peer);
    }, 1500 * retriesRef.current);
  };

  // One loop checks the real link: ICE state + outgoing video bytes. "Live" only when bytes actually flow.
  const startMonitor = (peer: Peer) => {
    if (monitorRef.current !== null) window.clearInterval(monitorRef.current);
    monitorRef.current = window.setInterval(async () => {
      if (peerRef.current !== peer) return;
      if (!dataRef.current && peer.open) openData(peer, false); // keep the laptop's keepalive fed
      const call = callRef.current;
      const pc = call?.peerConnection;
      if (!call || !pc) return;
      const s: string = pc.iceConnectionState;
      const now = Date.now();
      if (s === "failed") return scheduleRetry(peer);
      if (s === "disconnected") {
        if (!disconnectedSinceRef.current) disconnectedSinceRef.current = now;
        if (statusRef.current === "live") setBoth("reconnecting");
        if (now - disconnectedSinceRef.current > DISCONNECT_GRACE) scheduleRetry(peer);
        return;
      }
      disconnectedSinceRef.current = 0;
      if (s !== "connected" && s !== "completed") {
        if (now - callStartRef.current > CALL_TIMEOUT) scheduleRetry(peer);
        return;
      }
      let bytes = 0;
      try {
        const stats = await pc.getStats();
        stats.forEach((r: { type?: string; kind?: string; mediaType?: string; bytesSent?: number }) => {
          if (r.type === "outbound-rtp" && (r.kind === "video" || r.mediaType === "video")) bytes += r.bytesSent ?? 0;
        });
      } catch {
        return;
      }
      if (callRef.current !== call) return;
      const sending = isSendingVideo(bytesRef.current, bytes);
      bytesRef.current = bytes;
      if (sending) {
        retriesRef.current = 0;
        if (statusRef.current !== "live") setBoth("live");
      } else if (statusRef.current === "live") {
        setBoth("reconnecting");
      }
    }, 1000);
  };

  // Camera permission is requested ONLY after the laptop accepts.
  const startCamera = async (peer: Peer) => {
    let stream: MediaStream;
    try {
      stream = await openRearCamera();
    } catch (e) {
      send({ type: "bye" });
      return fail(cameraError(e));
    }
    if (peerRef.current !== peer) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    streamRef.current = stream;
    const v = videoRef.current;
    if (v) {
      v.srcObject = stream; // local preview stays visible while sending — rear camera is never mirrored
      v.play().catch(() => {});
    }
    stream.getVideoTracks()[0]?.addEventListener("ended", () => {
      if (streamRef.current !== stream) return;
      send({ type: "bye" });
      fail("The camera stopped (another app may have taken it). Tap Try again.");
    });
    placeCall(peer);
    startMonitor(peer);
  };

  const stop = () => {
    send({ type: "bye" }); // laptop shows Disconnected
    window.setTimeout(end, 150); // let the message leave first
    streamRef.current?.getTracks().forEach((t) => t.stop());
  };

  if (!isValidSession(session)) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold">Invalid pairing link</h1>
        <p className="text-sm text-muted-foreground">Start a session in LensPrompt on your laptop and scan the new QR code.</p>
      </Shell>
    );
  }

  const showVideo = status === "connecting" || status === "live" || status === "reconnecting";

  return (
    <Shell>
      <h1 className="text-xl font-semibold">Connect to Desktop</h1>
      {status === "ready" && (
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Tap <b>Connect</b> below.</li>
          <li>On the laptop, click <b>Accept iPhone</b>.</li>
          <li>Here, tap <b>Allow</b> when Safari asks for the camera.</li>
        </ol>
      )}
      {status !== "ready" && (
        <div className="flex flex-wrap gap-1 text-xs" aria-label="Connection steps">
          {STEPS.map((s) => (
            <span
              key={s.label}
              className={`rounded-full border px-2 py-0.5 ${s.on.includes(status) ? "border-primary text-foreground" : "border-border text-muted-foreground opacity-60"}`}
            >
              {s.label}
            </span>
          ))}
        </div>
      )}
      <p className="text-sm text-muted-foreground" role="status">
        {status === "pairing" && "Contacting the laptop…"}
        {status === "awaiting" && "Waiting for laptop approval — click “Accept iPhone” on the laptop."}
        {status === "connecting" && "Accepted. Starting the rear camera — tap Allow if Safari asks."}
        {status === "live" && "Streaming live to your laptop. Keep Safari open and the screen on."}
        {status === "reconnecting" && "Connection dropped — reconnecting…"}
        {status === "ended" && "Disconnected. The camera is off."}
        {status === "rejected" && "The laptop rejected this phone. Make a new QR code on the laptop to retry."}
      </p>
      <div className={showVideo ? "relative" : "hidden"}>
        <video ref={videoRef} autoPlay playsInline muted className="w-full rounded-lg bg-secondary" />
        {status === "live" && (
          <span className="absolute left-2 top-2 rounded bg-destructive px-2 py-0.5 text-xs font-semibold text-destructive-foreground">LIVE</span>
        )}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {(status === "ready" || status === "error" || status === "ended" || status === "rejected") && (
        <Button onClick={connect}>{status === "ready" ? "Connect" : "Try again"}</Button>
      )}
      {(status === "pairing" || status === "awaiting" || showVideo) && (
        <Button variant="outline" onClick={stop}>Stop</Button>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto flex min-h-[100dvh] max-w-md flex-col justify-center gap-4 bg-background p-6 text-foreground">{children}</main>;
}
