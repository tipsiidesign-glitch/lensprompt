import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import type Peer from "peerjs";
import type { MediaConnection, DataConnection } from "peerjs";
import { Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PEER_PREFIX, buildPairUrl, isVideoLive, makeSessionId } from "@/lib/pairing";

type Status =
  | "idle"
  | "pairing"
  | "waiting"
  | "approval"
  | "connecting"
  | "receiving"
  | "connected"
  | "reconnecting"
  | "ended"
  | "error";

type PairMessage =
  | { type: "pair-request" }
  | { type: "accepted" }
  | { type: "rejected" }
  | { type: "ping" }
  | { type: "pong" }
  | { type: "bye" };

const PING_INTERVAL = 3000;
const PONG_DEAD = 35000; // pairing channel silent this long -> Disconnected
const CAMERA_DEADLINE = 90000; // phone accepted but camera never arrived (permission prompt left open)
const RECOVER_DEADLINE = 30000; // video stopped and did not come back

const LABEL: Record<Status, string> = {
  idle: "Not started",
  pairing: "Creating QR code…",
  waiting: "Waiting for iPhone",
  approval: "Phone scanned — approve it",
  connecting: "Camera starting on iPhone…",
  receiving: "Receiving video…",
  connected: "Streaming live",
  reconnecting: "Reconnecting…",
  ended: "Disconnected",
  error: "Error",
};

const STEPS: { label: string; on: Status[] }[] = [
  { label: "Waiting for iPhone", on: ["waiting"] },
  { label: "Phone scanned", on: ["approval"] },
  { label: "Camera starting", on: ["connecting", "receiving"] },
  { label: "Streaming live", on: ["connected"] },
  { label: "Reconnecting", on: ["reconnecting"] },
  { label: "Disconnected", on: ["ended", "error"] },
];

export function DesktopMonitor() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [url, setUrl] = useState("");
  const [qr, setQr] = useState("");
  const [copied, setCopied] = useState(false);
  const peerRef = useRef<Peer | null>(null);
  const callRef = useRef<MediaConnection | null>(null);
  const dataRef = useRef<DataConnection | null>(null);
  const approvedPeerRef = useRef<string | null>(null); // the one phone allowed in this session
  const pendingPeerRef = useRef<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastPongRef = useRef(0);
  const lastProgressRef = useRef(0);
  const statusRef = useRef<Status>("idle");
  const keepaliveRef = useRef<number | null>(null);
  const liveCheckRef = useRef<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const setBoth = (s: Status) => {
    statusRef.current = s;
    setStatus(s);
  };

  const clearTimers = () => {
    if (keepaliveRef.current !== null) window.clearInterval(keepaliveRef.current);
    if (liveCheckRef.current !== null) window.clearInterval(liveCheckRef.current);
    keepaliveRef.current = liveCheckRef.current = null;
  };

  const send = (msg: PairMessage) => {
    const conn = dataRef.current;
    if (conn?.open) conn.send(msg);
  };

  const clearVideo = () => {
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  const teardown = () => {
    clearTimers();
    const call = callRef.current, data = dataRef.current, peer = peerRef.current;
    callRef.current = dataRef.current = peerRef.current = null; // null first so close handlers see a stale call
    approvedPeerRef.current = pendingPeerRef.current = null;
    call?.close();
    data?.close();
    peer?.destroy();
    clearVideo();
    setUrl("");
    setQr("");
  };

  useEffect(() => () => teardown(), []);

  const fail = (msg: string) => {
    teardown();
    setError(msg);
    setBoth("error");
  };

  const active = () => ["connecting", "receiving", "connected", "reconnecting"].includes(statusRef.current);

  // One watchdog for the whole approved session: pings the phone and enforces deadlines.
  const startKeepalive = () => {
    if (keepaliveRef.current !== null) return;
    lastPongRef.current = lastProgressRef.current = Date.now();
    keepaliveRef.current = window.setInterval(() => {
      send({ type: "ping" });
      const now = Date.now();
      const s = statusRef.current;
      if (now - lastPongRef.current > PONG_DEAD) {
        fail("Lost contact with the iPhone. Click “New QR code” and scan again.");
      } else if (s === "connecting" && now - lastProgressRef.current > CAMERA_DEADLINE) {
        fail("The iPhone camera never started. Check the camera permission on the phone, then make a new QR code.");
      } else if ((s === "receiving" || s === "reconnecting") && now - lastProgressRef.current > RECOVER_DEADLINE) {
        fail("The video could not recover. Both devices may need to be on the same Wi-Fi. Make a new QR code to retry.");
      }
    }, PING_INTERVAL);
  };

  // Only claim "Streaming live" when the remote track is unmuted AND the video element is actually playing frames.
  const watchVideo = (stream: MediaStream) => {
    if (liveCheckRef.current !== null) window.clearInterval(liveCheckRef.current);
    liveCheckRef.current = window.setInterval(() => {
      if (streamRef.current !== stream) return;
      const v = videoRef.current;
      const t = stream.getVideoTracks()[0];
      if (v?.paused && v.srcObject) v.play().catch(() => {});
      const live = isVideoLive({ trackState: t?.readyState, muted: t?.muted, videoWidth: v?.videoWidth ?? 0, paused: v?.paused ?? true });
      const s = statusRef.current;
      if (live) {
        lastProgressRef.current = Date.now();
        if (s === "receiving" || s === "reconnecting") setBoth("connected");
      } else if (s === "connected") {
        setBoth("reconnecting");
      }
    }, 400);
  };

  const attachStream = (stream: MediaStream) => {
    if (streamRef.current === stream) return; // PeerJS can fire "stream" once per track
    if (!stream.getVideoTracks()[0]) return fail("The iPhone stream contains no video. Make a new QR code and try again.");
    streamRef.current = stream;
    lastProgressRef.current = Date.now();
    const video = videoRef.current;
    if (video) {
      video.srcObject = stream; // remote phone stream — never the desktop's own camera
      video.play().catch(() => {});
    }
    if (statusRef.current !== "connected") setBoth("receiving");
    watchVideo(stream);
  };

  const onCall = (call: MediaConnection) => {
    // Only the phone the user accepted may send video; a re-call from it replaces the old link.
    if (!approvedPeerRef.current || call.peer !== approvedPeerRef.current || !active()) return call.close();
    const old = callRef.current;
    callRef.current = call;
    old?.close();
    call.answer(); // receive only; the desktop sends nothing
    call.on("stream", (s) => {
      if (callRef.current === call) attachStream(s);
    });
    call.on("close", () => {
      if (callRef.current !== call) return; // replaced by a newer call
      callRef.current = null;
      if (statusRef.current === "connected" || statusRef.current === "receiving") setBoth("reconnecting");
    });
    call.on("error", () => {
      if (callRef.current === call && statusRef.current === "connected") setBoth("reconnecting");
    });
    const pc = call.peerConnection;
    pc?.addEventListener("iceconnectionstatechange", () => {
      if (callRef.current !== call) return;
      const s = pc.iceConnectionState;
      if ((s === "disconnected" || s === "failed") && statusRef.current === "connected") setBoth("reconnecting"); // phone retries the call
    });
  };

  const onData = (conn: DataConnection) => {
    const approved = approvedPeerRef.current;
    if (approved ? conn.peer !== approved : pendingPeerRef.current !== null && pendingPeerRef.current !== conn.peer) {
      return conn.close(); // one phone per session
    }
    if (!approved && statusRef.current !== "waiting" && statusRef.current !== "approval") return conn.close();
    const old = dataRef.current;
    dataRef.current = conn;
    if (old && old !== conn) old.close();
    if (!approved) pendingPeerRef.current = conn.peer;
    conn.on("data", (raw: unknown) => {
      if (dataRef.current !== conn) return;
      const msg = raw as PairMessage;
      lastPongRef.current = Date.now();
      if (msg?.type === "pair-request" && !approvedPeerRef.current) setBoth("approval");
      else if (msg?.type === "ping") send({ type: "pong" });
      else if (msg?.type === "bye") {
        const c = callRef.current;
        callRef.current = null;
        c?.close();
        clearTimers();
        clearVideo();
        setError("");
        setBoth("ended");
      }
    });
    conn.on("close", () => {
      if (dataRef.current !== conn) return;
      dataRef.current = null;
      if (!approvedPeerRef.current) {
        pendingPeerRef.current = null;
        if (statusRef.current === "approval") setBoth("waiting"); // phone backed out; allow a new scan
      }
      // After approval the watchdog decides; the phone reopens this channel when it can.
    });
  };

  const start = async () => {
    teardown();
    setError("");
    setBoth("pairing");
    const session = makeSessionId();
    const link = buildPairUrl(window.location.origin, session);
    try {
      const { default: PeerCtor } = await import("peerjs");
      const peer = new PeerCtor(PEER_PREFIX + session);
      peerRef.current = peer;
      peer.on("open", async () => {
        if (peerRef.current !== peer) return;
        if (statusRef.current !== "pairing") return; // signaling reconnect, not a new session
        setUrl(link);
        setQr(await QRCode.toDataURL(link, { margin: 2, width: 240, errorCorrectionLevel: "M" }));
        setBoth("waiting");
      });
      peer.on("connection", onData);
      peer.on("call", onCall);
      peer.on("disconnected", () => {
        // Signaling socket dropped; media may still flow. Recover instead of destroying the peer.
        if (peerRef.current !== peer || peer.destroyed) return;
        window.setTimeout(() => {
          if (peerRef.current === peer && peer.disconnected && !peer.destroyed) peer.reconnect();
        }, 1000);
      });
      peer.on("error", (e) => {
        if (peerRef.current !== peer) return;
        const transient = e.type === "network" || e.type === "socket-error" || e.type === "server-error" || e.type === "socket-closed";
        if (transient && statusRef.current !== "pairing") return; // reconnect handler + watchdog cover this
        fail(
          transient
            ? "Cannot reach the pairing server. Check the laptop's internet connection, then make a new QR code."
            : e.type === "unavailable-id"
              ? "Session code clash. Make a new QR code."
              : e.type === "browser-incompatible"
                ? "This browser does not support live video. Use Chrome or Edge on the laptop."
                : `Connection error: ${e.message}`,
        );
      });
    } catch (e) {
      fail(e instanceof Error ? e.message : "Could not start the monitor.");
    }
  };

  const accept = () => {
    const conn = dataRef.current;
    if (!conn || !pendingPeerRef.current) return setBoth("waiting");
    approvedPeerRef.current = pendingPeerRef.current;
    setBoth("connecting"); // now the iPhone asks for its camera
    setUrl("");
    setQr(""); // QR is single-use once a phone is approved
    startKeepalive();
    const sendAccepted = () => conn.send({ type: "accepted" } satisfies PairMessage);
    if (conn.open) sendAccepted();
    else conn.on("open", sendAccepted);
  };

  const decline = () => {
    send({ type: "rejected" });
    const conn = dataRef.current;
    dataRef.current = null;
    pendingPeerRef.current = null;
    conn?.close();
    setBoth("waiting");
  };

  const disconnect = () => {
    send({ type: "bye" }); // tells the iPhone to stop its camera
    window.setTimeout(() => {
      teardown();
      setBoth("ended");
    }, 150); // let the bye message leave before closing the channel
    clearTimers();
    clearVideo();
  };

  const cancel = () => {
    teardown();
    setError("");
    setBoth("idle");
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Clipboard blocked — select and copy the link manually.");
    }
  };

  // Resume playback when the tab becomes visible again.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && videoRef.current?.paused && videoRef.current.srcObject) {
        videoRef.current.play().catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const showVideo = status === "receiving" || status === "connected" || status === "reconnecting";

  return (
    <div className="space-y-3 border-t border-border pt-3 text-xs text-muted-foreground">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Monitor className="h-4 w-4" /> Desktop Monitor
        <span className={`ml-auto text-xs font-normal ${status === "connected" ? "text-primary" : ""}`} role="status">
          {LABEL[status]}
        </span>
      </div>

      <ol className="list-decimal space-y-0.5 pl-4">
        <li>Click “Start monitor session” on this laptop.</li>
        <li>Scan the QR with the iPhone camera, open the link in Safari and tap <b>Connect</b>.</li>
        <li>Click <b>Accept iPhone</b> here.</li>
        <li>On the iPhone, tap <b>Allow</b> for the camera. The live rear camera appears below.</li>
      </ol>

      {status !== "idle" && (
        <div className="flex flex-wrap gap-1" aria-label="Connection steps">
          {STEPS.map((s) => (
            <span
              key={s.label}
              className={`rounded-full border px-2 py-0.5 ${s.on.includes(status) ? "border-primary text-foreground" : "border-border opacity-60"}`}
            >
              {s.label}
            </span>
          ))}
        </div>
      )}

      {status === "idle" && <Button size="sm" onClick={start}>Start monitor session</Button>}

      {(status === "waiting" || status === "approval") && url && (
        <div className="space-y-2">
          {qr && <img src={qr} alt="QR code with phone pairing link" width={200} height={200} className="rounded bg-background" />}
          <input readOnly value={url} className="w-full rounded border border-border bg-secondary px-2 py-1 text-foreground" onFocus={(e) => e.currentTarget.select()} />
          <Button size="sm" variant="secondary" onClick={copy}>{copied ? "Copied" : "Copy phone link"}</Button>
        </div>
      )}

      {status === "approval" && (
        <div className="space-y-2 rounded border border-primary p-2">
          <p className="text-foreground">An iPhone scanned your code and wants to send its camera.</p>
          <div className="flex gap-2">
            <Button size="sm" onClick={accept}>Accept iPhone</Button>
            <Button size="sm" variant="secondary" onClick={decline}>Reject</Button>
          </div>
        </div>
      )}

      {status === "connecting" && <p>Accepted. On the iPhone, tap “Allow” when Safari asks for the camera.</p>}

      <video ref={videoRef} autoPlay playsInline muted className={showVideo ? "w-full rounded bg-background" : "hidden"} />

      {error && <p className="text-destructive">{error}</p>}

      {(status === "connecting" || showVideo) && (
        <Button size="sm" variant="outline" onClick={disconnect}>Disconnect</Button>
      )}
      {(status === "pairing" || status === "waiting" || status === "approval") && (
        <Button size="sm" variant="outline" onClick={cancel}>Cancel session</Button>
      )}
      {(status === "ended" || status === "error") && (
        <div className="flex gap-2">
          <Button size="sm" onClick={start}>New QR code</Button>
          <Button size="sm" variant="outline" onClick={cancel}>Close</Button>
        </div>
      )}
      {status === "ended" && !error && <p>Session closed. Click “New QR code” to pair again.</p>}
    </div>
  );
}
