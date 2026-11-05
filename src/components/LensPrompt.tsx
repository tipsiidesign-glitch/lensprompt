import { useCallback, useEffect, useRef, useState } from "react";
import type { ImageSegmenter } from "@mediapipe/tasks-vision";
import {
  Camera,
  CircleDot,
  Download,
  Eye,
  EyeOff,
  ImagePlus,
  Mic,
  MicOff,
  Pause,
  Play,
  RotateCcw,
  ScanEye,
  SlidersHorizontal,
  SwitchCamera,
  Square,
  Type,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import {
  FILTER_DEFAULTS,
  PRESETS,
  canvasFilterSupported,
  cssFilter,
  grainCanvas,
  grainDataUrl,
  tempOverlay,
  type FilterState,
} from "@/lib/lensFilters";
import { analyzeFrame, type SceneReport, type Swatch } from "@/lib/sceneAnalysis";
import { createSegmenter } from "@/lib/segmentation";
import { writePersonAlpha } from "@/lib/personMask";
import { DesktopMonitorHelp } from "@/components/DesktopMonitorHelp";
import { DesktopMonitor } from "@/components/DesktopMonitor";

const STORAGE_KEY = "lensprompt.v1";
const HINT_KEY = "lensprompt.hintSeen";

type Settings = {
  speed: number;
  fontSize: number;
  opacity: number;
  lineHeight: number;
  offset: number;
  facing: "user" | "environment";
  mirror: boolean;
  brightness: number; // native camera exposure level (only used when supported)
};

const DEFAULTS: Settings = {
  speed: 40,
  fontSize: 30,
  opacity: 0.75,
  lineHeight: 1.6,
  offset: 12,
  facing: "user",
  mirror: true,
  brightness: 100,
};

const SAMPLE = `Welcome to LensPrompt.

Paste your script here, then press Play to start the smooth auto-scroll while you look straight into the lens.

Adjust speed, text size, opacity and position from the settings panel. Tap the screen for distraction-free mode.`;

type Tab = "camera" | "prompter" | "filters";
type SegStatus = "idle" | "loading" | "ready" | "error";

function fmt(s: number) {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, W: number, H: number) {
  const s = Math.max(W / img.naturalWidth, H / img.naturalHeight);
  const w = img.naturalWidth * s, h = img.naturalHeight * s;
  ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
}

export default function LensPrompt() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const maskRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const posRef = useRef(0);
  const lastTsRef = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const [script, setScript] = useState("");
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [filters, setFilters] = useState<FilterState>(FILTER_DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scrolling, setScrolling] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [tab, setTab] = useState<Tab | null>(null);
  const [prompterView, setPrompterView] = useState<"script" | "settings">("script");
  const [focusMode, setFocusMode] = useState(false);
  const [multiCam, setMultiCam] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultExt, setResultExt] = useState("webm");
  const [resultProcessed, setResultProcessed] = useState(false);

  const [exposure, setExposure] = useState<{ min: number; max: number; step: number } | null>(null);
  const [portrait, setPortrait] = useState(true);
  const [mobile, setMobile] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [orientationStop, setOrientationStop] = useState(false);

  // studio
  const [filterSupport, setFilterSupport] = useState(true);
  const [captureSupport, setCaptureSupport] = useState(true);
  const [segStatus, setSegStatus] = useState<SegStatus>("idle");
  const [segError, setSegError] = useState<string | null>(null);
  const [bgEnabled, setBgEnabled] = useState(false);
  const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null);
  const [bgThumb, setBgThumb] = useState<string | null>(null);
  const [fps, setFps] = useState(0);
  const [report, setReport] = useState<SceneReport | null>(null);

  const segRef = useRef<ImageSegmenter | null>(null);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const bgImageRef = useRef(bgImage);
  bgImageRef.current = bgImage;

  const dismissHint = () => {
    setShowHint(false);
    try {
      localStorage.setItem(HINT_KEY, "1");
    } catch {
      /* ignore */
    }
  };

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setSettings((s) => ({ ...s, [k]: v }));
  const setF = <K extends keyof FilterState>(k: K, v: FilterState[K]) =>
    setFilters((f) => ({ ...f, [k]: v, preset: k === "bake" ? f.preset : "Custom" }));

  /* ---------- persistence ---------- */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (typeof p.script === "string" && p.script !== SAMPLE) setScript(p.script);
        if (p.settings) setSettings({ ...DEFAULTS, ...p.settings });
        if (p.filters) setFilters({ ...FILTER_DEFAULTS, ...p.filters });
      }
    } catch {
      /* ignore */
    }
    try {
      if (!localStorage.getItem(HINT_KEY)) setShowHint(true);
    } catch {
      /* ignore */
    }
    setFilterSupport(canvasFilterSupported());
    setCaptureSupport(typeof HTMLCanvasElement !== "undefined" && "captureStream" in HTMLCanvasElement.prototype);
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ script, settings, filters }));
    } catch {
      /* ignore */
    }
  }, [script, settings, filters, loaded]);

  /* ---------- camera ---------- */
  const startCamera = useCallback(
    async (facing: "user" | "environment") => {
      setError(null);
      setReady(false);
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("This browser does not support camera access.");
        }
        streamRef.current?.getTracks().forEach((t) => t.stop());
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facing },
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 },
          },
          audio: { echoCancellation: true, noiseSuppression: true },
        });
        streamRef.current = stream;
        stream.getAudioTracks().forEach((t) => (t.enabled = micOn));
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setReady(true);
        try {
          const vt = stream.getVideoTracks()[0];
          const caps = (vt?.getCapabilities?.() ?? {}) as Record<string, unknown>;
          const ec = caps["exposureCompensation"] as { min?: number; max?: number; step?: number } | undefined;
          if (ec && typeof ec.min === "number" && typeof ec.max === "number" && ec.max > ec.min) {
            setExposure({ min: ec.min, max: ec.max, step: ec.step || 0.1 });
          } else setExposure(null);
        } catch {
          setExposure(null);
        }
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          setMultiCam(devices.filter((d) => d.kind === "videoinput").length > 1);
        } catch {
          /* ignore */
        }
      } catch (e) {
        const err = e as DOMException;
        setReady(false);
        setError(
          err?.name === "NotAllowedError"
            ? "Camera and microphone access was blocked. Allow access in your browser settings, then retry."
            : err?.name === "NotFoundError"
              ? "No camera was found on this device."
              : err?.name === "NotReadableError"
                ? "Your camera is being used by another app. Close it and retry."
                : (err?.message ?? "Could not start the camera."),
        );
      }
    },
    [micOn],
  );

  useEffect(() => {
    void startCamera(DEFAULTS.facing);
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- native exposure ---------- */
  useEffect(() => {
    if (!exposure || !ready) return;
    const vt = streamRef.current?.getVideoTracks()[0];
    if (!vt) return;
    const t = settings.brightness - 100;
    let ev = t >= 0 ? (t / 40) * exposure.max : (-t / 20) * exposure.min;
    ev = Math.max(exposure.min, Math.min(exposure.max, Math.round(ev / exposure.step) * exposure.step));
    vt.applyConstraints({ advanced: [{ exposureCompensation: ev } as MediaTrackConstraintSet] }).catch(() =>
      setExposure(null),
    );
  }, [exposure, ready, settings.brightness]);

  /* ---------- orientation ---------- */
  useEffect(() => {
    const mq = window.matchMedia("(orientation: portrait)");
    setMobile(window.matchMedia("(pointer: coarse)").matches);
    const upd = () => setPortrait(mq.matches);
    upd();
    mq.addEventListener?.("change", upd);
    window.addEventListener("orientationchange", upd);
    window.addEventListener("resize", upd);
    return () => {
      mq.removeEventListener?.("change", upd);
      window.removeEventListener("orientationchange", upd);
      window.removeEventListener("resize", upd);
    };
  }, []);
  const portraitOk = !mobile || portrait;

  const flipCamera = async () => {
    const next = settings.facing === "user" ? "environment" : "user";
    set("facing", next);
    set("mirror", next === "user");
    await startCamera(next);
  };

  const toggleMic = () => {
    const next = !micOn;
    setMicOn(next);
    streamRef.current?.getAudioTracks().forEach((t) => (t.enabled = next));
  };

  /* ---------- background segmentation ---------- */
  const loadSegmenter = async () => {
    if (segRef.current || segStatus === "loading") return;
    setSegStatus("loading");
    setSegError(null);
    try {
      segRef.current = await createSegmenter();
      setSegStatus("ready");
    } catch (e) {
      setSegStatus("error");
      setSegError((e as Error)?.message || "Person segmentation could not start in this browser.");
    }
  };

  const pickBackground = (file: File) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setBgImage(img);
      setBgThumb((old) => {
        if (old) URL.revokeObjectURL(old);
        return url;
      });
      setBgEnabled(true);
      void loadSegmenter();
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setError("That image could not be opened.");
    };
    img.src = url;
  };

  useEffect(() => () => segRef.current?.close(), []);

  const bgActive = bgEnabled && !!bgImage && segStatus === "ready";
  const bgActiveRef = useRef(bgActive);
  bgActiveRef.current = bgActive;
  const pipelineOn = ready && (bgActive || (captureSupport && filters.bake));

  /* ---------- canvas render pipeline (only when compositing or baking) ---------- */
  useEffect(() => {
    if (!pipelineOn) return;
    let raf = 0;
    let frames = 0;
    let last = performance.now();
    const fs = filterSupport;
    const small = document.createElement("canvas");
    const person = document.createElement("canvas");
    const mask = (maskRef.current ??= document.createElement("canvas"));
    let maskImg: ImageData | null = null;
    let prev: Float32Array | null = null;
    let maskValid = false;
    let lastVideoTime = -1;

    const loop = () => {
      raf = requestAnimationFrame(loop);
      const v = videoRef.current, c = canvasRef.current;
      if (!v || !c || v.readyState < 2 || !v.videoWidth) return;
      const W = v.videoWidth, H = v.videoHeight;
      if (c.width !== W || c.height !== H) {
        c.width = W;
        c.height = H;
      }
      const ctx = c.getContext("2d");
      if (!ctx) return;
      const f = filtersRef.current;
      const fstr = fs ? cssFilter(f) : "none";
      const seg = segRef.current, img = bgImageRef.current;
      // Reset every frame, including when a replacement PNG has transparent pixels.
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      ctx.filter = "none";
      ctx.clearRect(0, 0, W, H);

      if (bgActiveRef.current && seg && img) {
        const sw = 256, sh = Math.max(1, Math.round((256 * H) / W));
        if (small.width !== sw || small.height !== sh) {
          small.width = sw;
          small.height = sh;
        }
        const smallCtx = small.getContext("2d");
        if (!smallCtx) return;
        smallCtx.drawImage(v, 0, 0, sw, sh);
        if (v.currentTime !== lastVideoTime) {
        lastVideoTime = v.currentTime;
        try {
          maskValid = false;
          seg.segmentForVideo(small, performance.now(), (res) => {
            const m = res.confidenceMasks?.[0];
            if (!m) return;
            const d = m.getAsFloat32Array();
            const mw = m.width, mh = m.height;
            if (mask.width !== mw || mask.height !== mh) {
              mask.width = mw;
              mask.height = mh;
              maskImg = null;
              prev = null;
            }
            const mctx = mask.getContext("2d");
            if (!mctx) return;
            if (!maskImg) maskImg = mctx.createImageData(mw, mh);
            if (!prev || prev.length !== d.length) prev = new Float32Array(d);
            writePersonAlpha(d, prev, maskImg.data);
            mctx.putImageData(maskImg, 0, 0);
            maskValid = true;
          });
          if (!maskValid) throw new Error("No person confidence mask was returned.");
        } catch (e) {
          maskValid = false;
          prev = null;
          mask.getContext("2d")?.clearRect(0, 0, mask.width, mask.height);
          setBgEnabled(false);
          setSegStatus("error");
          setSegError((e as Error)?.message || "Person segmentation stopped.");
        }
        }
        if (!maskValid) {
          ctx.drawImage(v, 0, 0, W, H);
          return;
        }
        if (person.width !== W || person.height !== H) {
          person.width = W;
          person.height = H;
        }
        const pc = person.getContext("2d");
        if (!pc) return;
        pc.globalCompositeOperation = "source-over";
        pc.clearRect(0, 0, W, H);
        pc.drawImage(v, 0, 0, W, H);
        pc.globalCompositeOperation = "destination-in";
        if (fs) pc.filter = "blur(2px)"; // feathered edge
        pc.drawImage(mask, 0, 0, W, H);
        if (fs) pc.filter = "none";
        pc.globalCompositeOperation = "source-over";
        if (fs) ctx.filter = fstr;
        drawCover(ctx, img, W, H);
        ctx.drawImage(person, 0, 0);
      } else {
        if (fs) ctx.filter = fstr;
        ctx.drawImage(v, 0, 0, W, H);
      }
      if (fs) ctx.filter = "none";

      const tint = tempOverlay(f.temperature);
      if (tint) {
        ctx.globalCompositeOperation = "soft-light";
        ctx.fillStyle = tint;
        ctx.fillRect(0, 0, W, H);
      }
      if (f.grain > 0) {
        const pat = ctx.createPattern(grainCanvas(), "repeat");
        if (pat) {
          ctx.globalCompositeOperation = "overlay";
          ctx.globalAlpha = (f.grain / 100) * 0.6;
          ctx.save();
          ctx.translate(Math.random() * 128, Math.random() * 128);
          ctx.fillStyle = pat;
          ctx.fillRect(-128, -128, W + 256, H + 256);
          ctx.restore();
          ctx.globalAlpha = 1;
        }
      }
      ctx.globalCompositeOperation = "source-over";

      frames++;
      const now = performance.now();
      if (now - last >= 1000) {
        setFps(Math.round((frames * 1000) / (now - last)));
        frames = 0;
        last = now;
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [pipelineOn, filterSupport, settings.facing, bgActive]);

  /* ---------- auto scroll ---------- */
  useEffect(() => {
    if (!scrolling) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      return;
    }
    const el = scrollRef.current;
    if (!el) return;
    posRef.current = el.scrollTop;
    lastTsRef.current = 0;
    const step = (ts: number) => {
      if (!lastTsRef.current) lastTsRef.current = ts;
      const dt = (ts - lastTsRef.current) / 1000;
      lastTsRef.current = ts;
      posRef.current += settings.speed * dt;
      const max = el.scrollHeight - el.clientHeight;
      if (posRef.current >= max) {
        el.scrollTop = max;
        setScrolling(false);
        return;
      }
      el.scrollTop = posRef.current;
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [scrolling, settings.speed]);

  const resetScroll = () => {
    setScrolling(false);
    posRef.current = 0;
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  };

  /* ---------- timer ---------- */
  useEffect(() => {
    if (!recording) return;
    const id = window.setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => window.clearInterval(id);
  }, [recording]);

  /* ---------- recording ---------- */
  const startRecording = () => {
    const stream = streamRef.current;
    if (!stream || !ready || stream.getVideoTracks()[0]?.readyState !== "live") return;
    if (!portraitOk) {
      setError("Turn your phone upright (portrait) to record.");
      return;
    }
    setOrientationStop(false);
    if (typeof MediaRecorder === "undefined") {
      setError("Recording is not supported in this browser.");
      return;
    }
    let recStream: MediaStream = stream;
    let processed = false;
    if (pipelineOn && captureSupport && canvasRef.current) {
      try {
        const cs = canvasRef.current.captureStream(30);
        recStream = new MediaStream([...cs.getVideoTracks(), ...stream.getAudioTracks()]);
        recStreamRef.current = cs;
        processed = true;
      } catch {
        recStream = stream;
        setError("Processed capture failed. This take records the raw camera without background or filters.");
      }
    } else if (bgActive && !captureSupport) {
      setError("Background replacement is preview only here. This take records the raw camera.");
    }
    const candidates = [
      "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
      "video/mp4",
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
    ];
    const mimeType = candidates.find((t) => MediaRecorder.isTypeSupported(t));
    try {
      const rec = new MediaRecorder(recStream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const type = rec.mimeType || mimeType || "video/webm";
        const blob = new Blob(chunksRef.current, { type });
        setResultExt(type.includes("mp4") ? "mp4" : "webm");
        setResultUrl((old) => {
          if (old) URL.revokeObjectURL(old);
          return URL.createObjectURL(blob);
        });
        recStreamRef.current?.getTracks().forEach((t) => t.stop());
        recStreamRef.current = null;
      };
      rec.start(1000);
      recorderRef.current = rec;
      setResultProcessed(processed);
      setElapsed(0);
      setRecording(true);
      setScrolling(true);
      setTab(null);
    } catch {
      recStreamRef.current?.getTracks().forEach((t) => t.stop());
      recStreamRef.current = null;
      setError("Recording could not be started on this device.");
    }
  };

  const stopRecording = () => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
    recorderRef.current = null;
    setRecording(false);
    setScrolling(false);
  };

  useEffect(() => {
    if (recording && !portraitOk) {
      stopRecording();
      setOrientationStop(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portraitOk, recording]);

  useEffect(() => {
    return () => {
      if (resultUrl) URL.revokeObjectURL(resultUrl);
    };
  }, [resultUrl]);

  const runAnalysis = () => {
    const v = videoRef.current;
    if (!v) return;
    const r = analyzeFrame(v, bgActive ? maskRef.current : null);
    if (!r) setError("Camera frame not ready yet — try again in a second.");
    setReport(r);
  };

  /* ---------- preview styling ---------- */
  const exposureFallback =
    !exposure && settings.brightness !== 100 ? ` brightness(${settings.brightness / 100})` : "";
  const colourCss = cssFilter(filters);
  // When the canvas pipeline is on and ctx.filter works, colour is already baked into the canvas.
  const canvasCss = !filterSupport ? colourCss + exposureFallback : exposureFallback.trim() || undefined;
  const videoCss = colourCss + exposureFallback;
  const tint = tempOverlay(filters.temperature);
  const controlsHidden = focusMode;
  const mirrorTx = settings.mirror ? "scaleX(-1)" : undefined;

  const bakeLabel = !captureSupport
    ? "This browser can't record a processed canvas — filters stay preview-only."
    : filters.bake
      ? filterSupport
        ? "Baked into recording (processed canvas). May lower frame rate."
        : "Grain & temperature are baked; brightness/contrast/saturation/B&W stay preview-only in this browser."
      : "Preview only — recording keeps the untouched camera stream.";

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-background text-foreground">
      {/* camera layer — untouched stream */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="absolute inset-0 h-full w-full object-cover"
        style={{ transform: mirrorTx, filter: videoCss, opacity: pipelineOn ? 0 : 1 }}
      />
      {/* processed layer — only when compositing/baking */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full object-cover"
        style={{ transform: mirrorTx, filter: canvasCss, display: pipelineOn ? "block" : "none" }}
      />
      {!pipelineOn && tint && (
        <div className="pointer-events-none absolute inset-0" style={{ background: tint, mixBlendMode: "soft-light" }} />
      )}
      {!pipelineOn && filters.grain > 0 && (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage: `url(${grainDataUrl()})`,
            mixBlendMode: "overlay",
            opacity: (filters.grain / 100) * 0.6,
          }}
        />
      )}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/50 via-transparent to-black/60" />

      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
          <div className="max-w-sm space-y-4">
            <Camera className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{error ?? "Starting camera…"}</p>
            {error && (
              <Button variant="secondary" onClick={() => void startCamera(settings.facing)}>
                Retry
              </Button>
            )}
          </div>
        </div>
      )}

      {/* teleprompter overlay */}
      <div
        className="absolute inset-x-0 bottom-0"
        style={{ top: `${settings.offset}%` }}
        onClick={() => setFocusMode((f) => !f)}
      >
        <div ref={scrollRef} className="prompter-scroll h-full overflow-y-auto px-5 pb-[45vh] pt-4 sm:px-10">
          <p
            className="prompter-text mx-auto max-w-3xl whitespace-pre-wrap text-center font-semibold"
            style={{ fontSize: `${settings.fontSize}px`, lineHeight: settings.lineHeight, opacity: settings.opacity }}
          >
            {script}
          </p>
        </div>
      </div>

      {/* top bar */}
      {!controlsHidden && (
        <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-2 p-3">
          <div className="glass-chip flex items-center gap-2">
            {recording ? (
              <CircleDot className="h-3.5 w-3.5 animate-pulse text-destructive" />
            ) : (
              <span className="h-2 w-2 rounded-full bg-muted-foreground" />
            )}
            <span className="tabular-nums text-xs tracking-widest">{fmt(elapsed)}</span>
          </div>
          <div className="flex flex-wrap justify-center gap-1.5">
            <span className={`glass-chip flex items-center gap-1.5 text-xs ${portraitOk ? "" : "text-destructive"}`}>
              <span className={`h-2 w-2 rounded-full ${portraitOk ? "bg-primary" : "bg-destructive"}`} />
              {portraitOk ? "Portrait ready" : "Rotate upright"}
            </span>
            {pipelineOn && (
              <span className="glass-chip text-xs tabular-nums">
                {bgActive ? "BG" : "FX"} · {fps} fps
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="glass" size="icon" onClick={toggleMic} aria-label="Toggle microphone">
              {micOn ? <Mic /> : <MicOff />}
            </Button>
            {multiCam && (
              <Button variant="glass" size="icon" onClick={() => void flipCamera()} aria-label="Switch camera" disabled={recording}>
                <SwitchCamera />
              </Button>
            )}
          </div>
        </div>
      )}

      {controlsHidden && (
        <button
          onClick={() => setFocusMode(false)}
          className="glass-chip absolute right-3 top-3 z-20 flex items-center gap-2 text-xs"
        >
          <Eye className="h-3.5 w-3.5" /> Show controls
        </button>
      )}

      {/* bottom controls */}
      {!controlsHidden && (
        <div className="absolute inset-x-0 bottom-0 z-20 mx-auto max-w-2xl space-y-3 p-3 pb-5">
          {tab && (
            <div className="glass-panel max-h-[52dvh] space-y-4 overflow-y-auto" role="region" aria-label={tab === "camera" ? "Camera studio" : tab === "prompter" ? "Teleprompter" : "Filters"}>
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-widest text-muted-foreground">
                  {tab === "camera" ? "Camera studio" : tab === "prompter" ? "Teleprompter" : "Filters"}
                </span>
                <Button variant="ghost" size="icon" onClick={() => setTab(null)} aria-label="Close panel">
                  <X />
                </Button>
              </div>

              {tab === "camera" && (
                <>
                  <Section title="Scene analysis">
                    <Button variant="secondary" className="w-full" onClick={runAnalysis} disabled={!ready}>
                      <ScanEye /> Analyse current frame
                    </Button>
                    {report ? (
                      <div className="space-y-3 text-sm">
                        <Info label="Background" text={report.background.summary} swatches={report.background.swatches} />
                        <Info
                          label={`Outfit${report.outfit.source === "frame-region" ? " (lower-centre estimate)" : " (person mask)"}`}
                          text={report.outfit.summary}
                          swatches={report.outfit.swatches}
                        />
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <Stat k="Light" v={report.lighting.level} />
                          <Stat k="Temperature" v={report.lighting.temperature} />
                          <Stat k="Contrast" v={report.lighting.contrast} />
                          <Stat k="Mood" v={report.lighting.mood} />
                          <div className="col-span-2">
                            <Stat k="Direction" v={report.lighting.direction} />
                          </div>
                        </div>
                        <div className="space-y-2">
                          {report.suggestions.map((s) => (
                            <div key={s.title} className="flex items-start gap-2 text-xs">
                              {s.colors && (
                                <div className="flex shrink-0 gap-1 pt-0.5">
                                  {s.colors.map((c) => (
                                    <span key={c} className="h-4 w-4 rounded-full border border-border" style={{ background: c }} />
                                  ))}
                                </div>
                              )}
                              <span>
                                <span className="font-medium text-foreground">{s.title}: </span>
                                <span className="text-muted-foreground">{s.text}</span>
                              </span>
                            </div>
                          ))}
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              const p = PRESETS.find((x) => x.name === report.preset);
                              if (p) setFilters((f) => ({ ...f, ...p.values, preset: p.name }));
                            }}
                          >
                            Apply {report.preset}
                          </Button>
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          Colours and light are measured from real pixels. Descriptions are rule-based, not object
                          recognition — no AI model identifies objects or clothing.
                        </p>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Samples the live frame for background and outfit colours, lighting and colour pairings.
                      </p>
                    )}
                  </Section>

                  <Section title="Background replacement">
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) pickBackground(f);
                        e.target.value = "";
                      }}
                    />
                    <div className="flex items-center gap-3">
                      {bgThumb ? (
                        <img src={bgThumb} alt="Chosen background" className="h-14 w-10 rounded-md object-cover" />
                      ) : (
                        <div className="flex h-14 w-10 items-center justify-center rounded-md border border-border">
                          <ImagePlus className="h-4 w-4 text-muted-foreground" />
                        </div>
                      )}
                      <div className="flex flex-1 flex-wrap gap-2">
                        <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()} disabled={recording}>
                          {bgImage ? "Change image" : "Choose image"}
                        </Button>
                        {bgImage && (
                          <Button
                            variant={bgEnabled ? "default" : "secondary"}
                            size="sm"
                            disabled={recording}
                            onClick={() => {
                              setBgEnabled((b) => !b);
                              void loadSegmenter();
                            }}
                          >
                            {bgEnabled ? "On" : "Off"}
                          </Button>
                        )}
                      </div>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {segStatus === "loading"
                        ? "Loading on-device person segmentation (free MediaPipe model, downloaded once)…"
                        : segStatus === "error"
                          ? `Unsupported here: ${segError}. Background replacement is unavailable in this browser.`
                          : segStatus === "ready"
                            ? `On-device person segmentation ready${bgActive ? ` · ${fps} fps` : ""}. ${bgActive && captureSupport ? "Replacement is included in processed recording." : ""} Edges are softened; fine hair and fast motion can show artefacts.`
                            : "Uses on-device person segmentation (MediaPipe) — no account or API key. Choose an image to start."}
                      {!captureSupport && " Preview only: this browser cannot record processed video; recordings use the raw camera."}
                    </p>
                  </Section>

                  <Section title="Camera">
                    <div className="flex flex-wrap gap-2">
                      {multiCam && (
                        <Button variant="secondary" size="sm" onClick={() => void flipCamera()} disabled={recording}>
                          <SwitchCamera /> {settings.facing === "user" ? "Use rear" : "Use front"}
                        </Button>
                      )}
                      <Button variant="secondary" size="sm" onClick={() => set("mirror", !settings.mirror)}>
                        Mirror preview: {settings.mirror ? "on" : "off"}
                      </Button>
                      <Button variant="secondary" size="sm" onClick={toggleMic}>
                        {micOn ? <Mic /> : <MicOff />} Mic {micOn ? "on" : "off"}
                      </Button>
                    </div>
                    {exposure && (
                      <Row label="Camera exposure (native)" value={`${settings.brightness}%`}>
                        <Slider
                          value={[settings.brightness]}
                          min={80}
                          max={140}
                          step={1}
                          onValueChange={(v) => set("brightness", v[0] ?? 100)}
                        />
                      </Row>
                    )}
                  </Section>
                  <DesktopMonitor />
                  <DesktopMonitorHelp />
                </>
              )}

              {tab === "prompter" && (
                <>
                  <div className="grid grid-cols-2 gap-1 rounded-lg bg-secondary p-1">
                    {(["script", "settings"] as const).map((v) => (
                      <button
                        key={v}
                        onClick={() => setPrompterView(v)}
                        className={`rounded-md py-1.5 text-xs capitalize ${prompterView === v ? "bg-background text-foreground" : "text-muted-foreground"}`}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                  {prompterView === "script" ? (
                    <div className="space-y-3">
                      <Textarea
                        value={script}
                        onChange={(e) => setScript(e.target.value)}
                        placeholder="Paste or type your script…"
                        className="min-h-36 resize-none border-white/10 bg-black/40"
                      />
                      <div className="flex gap-2">
                        <Button
                          variant="secondary"
                          className="flex-1"
                          onClick={async () => {
                            try {
                              const text = await navigator.clipboard.readText();
                              if (text) setScript(text);
                            } catch {
                              setError("Clipboard access was blocked — paste manually instead.");
                            }
                          }}
                        >
                          Paste
                        </Button>
                        <Button variant="secondary" className="flex-1" onClick={() => setScript("")}>
                          Clear
                        </Button>
                        <Button className="flex-1" onClick={() => setTab(null)}>
                          Done
                        </Button>
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        {script.trim() ? `${script.trim().split(/\s+/).length} words · ~${Math.max(1, Math.round(script.trim().split(/\s+/).length / 150))} min read` : "Script stays on this device."}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <Row label="Speed" value={`${settings.speed} px/s`}>
                        <Slider value={[settings.speed]} min={5} max={200} step={1} onValueChange={(v) => set("speed", v[0] ?? 0)} />
                      </Row>
                      <Row label="Text size" value={`${settings.fontSize} px`}>
                        <Slider value={[settings.fontSize]} min={14} max={72} step={1} onValueChange={(v) => set("fontSize", v[0] ?? 0)} />
                      </Row>
                      <Row label="Opacity" value={`${Math.round(settings.opacity * 100)}%`}>
                        <Slider value={[settings.opacity * 100]} min={20} max={100} step={1} onValueChange={(v) => set("opacity", (v[0] ?? 100) / 100)} />
                      </Row>
                      <Row label="Brightness" value={`${settings.brightness}%`}>
                        <Slider aria-label="Brightness" value={[settings.brightness]} min={80} max={140} step={1} onValueChange={(v) => set("brightness", v[0] ?? 100)} />
                        <p className="text-[11px] text-muted-foreground">{exposure ? "Camera exposure — affects recording" : "Preview only"}</p>
                      </Row>
                      <Row label="Line spacing" value={settings.lineHeight.toFixed(1)}>
                        <Slider value={[settings.lineHeight * 10]} min={10} max={26} step={1} onValueChange={(v) => set("lineHeight", (v[0] ?? 0) / 10)} />
                      </Row>
                      <Row label="Vertical position" value={`${settings.offset}%`}>
                        <Slider value={[settings.offset]} min={0} max={60} step={1} onValueChange={(v) => set("offset", v[0] ?? 0)} />
                      </Row>
                      <div className="flex gap-2 pt-1">
                        <Button variant="secondary" className="flex-1" onClick={() => set("mirror", !settings.mirror)}>
                          {settings.mirror ? "Mirror: on" : "Mirror: off"}
                        </Button>
                        <Button
                          variant="secondary"
                          className="flex-1"
                          onClick={() => setSettings((s) => ({ ...DEFAULTS, facing: s.facing, mirror: s.facing === "user" }))}
                        >
                          Reset defaults
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}

              {tab === "filters" && (
                <div className="space-y-4">
                  <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                    {PRESETS.map((p) => (
                      <button
                        key={p.name}
                        onClick={() => setFilters((f) => ({ ...f, ...p.values, preset: p.name }))}
                        className={`shrink-0 rounded-full border px-3 py-1.5 text-xs ${filters.preset === p.name ? "border-primary bg-primary text-primary-foreground" : "border-border text-foreground/80"}`}
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>
                  <Row label="Brightness" value={`${filters.brightness}%`}>
                    <Slider value={[filters.brightness]} min={60} max={150} step={1} onValueChange={(v) => setF("brightness", v[0] ?? 100)} />
                  </Row>
                  <Row label="Contrast" value={`${filters.contrast}%`}>
                    <Slider value={[filters.contrast]} min={60} max={150} step={1} onValueChange={(v) => setF("contrast", v[0] ?? 100)} />
                  </Row>
                  <Row label="Saturation" value={`${filters.saturation}%`}>
                    <Slider value={[filters.saturation]} min={0} max={180} step={1} onValueChange={(v) => setF("saturation", v[0] ?? 100)} />
                  </Row>
                  <Row label="Temperature" value={filters.temperature > 0 ? `+${filters.temperature} warm` : filters.temperature < 0 ? `${filters.temperature} cool` : "0"}>
                    <Slider value={[filters.temperature]} min={-50} max={50} step={1} onValueChange={(v) => setF("temperature", v[0] ?? 0)} />
                  </Row>
                  <Row label="Grain" value={`${filters.grain}`}>
                    <Slider value={[filters.grain]} min={0} max={100} step={1} onValueChange={(v) => setF("grain", v[0] ?? 0)} />
                  </Row>
                  <div className="flex gap-2">
                    <Button variant="secondary" className="flex-1" onClick={() => setF("mono", !filters.mono)}>
                      B&W: {filters.mono ? "on" : "off"}
                    </Button>
                    <Button
                      variant="secondary"
                      className="flex-1"
                      onClick={() => setFilters((f) => ({ ...FILTER_DEFAULTS, bake: f.bake }))}
                    >
                      Reset
                    </Button>
                  </div>
                  <div className="space-y-2 rounded-lg border border-border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm">Apply to recording</span>
                      <Button
                        size="sm"
                        variant={filters.bake ? "default" : "secondary"}
                        disabled={!captureSupport || recording}
                        onClick={() => setF("bake", !filters.bake)}
                      >
                        {filters.bake ? "On" : "Off"}
                      </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {bgActive && !filters.bake && captureSupport
                        ? "Background replacement is on, so the processed video is recorded — filters are included."
                        : bakeLabel}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {showHint && !recording && !tab && (
            <div className="glass-chip flex items-center justify-between gap-2 text-xs">
              <span>Tip: open Teleprompter to add your script, then Scroll or Record. Tap the screen to hide controls.</span>
              <button onClick={dismissHint} aria-label="Dismiss tip">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {(orientationStop || (!portraitOk && ready)) && (
            <div className="glass-panel text-sm text-destructive">
              {orientationStop
                ? "Recording stopped because the phone was rotated. Your take so far is saved — turn your phone upright (portrait) to record again."
                : "Turn your phone upright (portrait) to record."}
            </div>
          )}

          {error && ready && (
            <div className="glass-panel flex items-start justify-between gap-3 text-sm text-destructive">
              <span>{error}</span>
              <button onClick={() => setError(null)} aria-label="Dismiss">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            <Button variant="glass" size="icon" onClick={resetScroll} aria-label="Restart script">
              <RotateCcw />
            </Button>
            <Button variant="prompter" size="lg" className="flex-1" onClick={() => setScrolling((s) => !s)}>
              {scrolling ? <Pause /> : <Play />}
              {scrolling ? "Pause" : "Scroll"}
            </Button>
            <Button
              variant={recording ? "destructive" : "record"}
              size="icon-lg"
              onClick={recording ? stopRecording : startRecording}
              disabled={!ready || (!recording && !portraitOk)}
              aria-label={recording ? "Stop recording" : "Start recording"}
            >
              {recording ? <Square /> : <CircleDot />}
            </Button>
            <Button variant="glass" size="icon" onClick={() => setFocusMode(true)} aria-label="Hide controls">
              <EyeOff />
            </Button>
          </div>

          <div className="grid grid-cols-3 gap-1 rounded-xl border border-border bg-background/60 p-1 backdrop-blur-md">
            {(
              [
                ["camera", "Camera", Camera],
                ["prompter", "Teleprompter", Type],
                ["filters", "Filters", SlidersHorizontal],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                onClick={() => setTab(tab === id ? null : id)}
                className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium transition-colors ${tab === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                <Icon className="h-3.5 w-3.5" /> {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* result preview */}
      {resultUrl && (
        <div className="absolute inset-0 z-30 flex flex-col bg-black/90 p-4">
          <div className="flex items-center justify-between pb-3">
            <span className="text-sm font-medium">
              Your take <span className="text-xs text-muted-foreground">· {resultProcessed ? "with background/filters" : "raw camera"}</span>
            </span>
            <Button variant="ghost" size="icon" onClick={() => setResultUrl(null)} aria-label="Close preview">
              <X />
            </Button>
          </div>
          <video src={resultUrl} controls playsInline className="min-h-0 flex-1 rounded-xl bg-black object-contain" />
          <div className="flex gap-2 pt-3">
            <Button variant="secondary" className="flex-1" onClick={() => setResultUrl(null)}>
              Record again
            </Button>
            <Button asChild className="flex-1">
              <a href={resultUrl} download={`lensprompt-take.${resultExt}`}>
                <Download /> Download
              </a>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2 border-t border-border pt-3 first-of-type:border-0 first-of-type:pt-0">
      <div className="text-xs font-medium text-foreground/90">{title}</div>
      {children}
    </div>
  );
}

function Info({ label, text, swatches }: { label: string; text: string; swatches: Swatch[] }) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div>{text}</div>
      <div className="flex gap-2">
        {swatches.map((s) => (
          <div key={s.hex} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="h-5 w-5 rounded-md border border-border" style={{ background: s.hex }} />
            {Math.round(s.share * 100)}%
          </div>
        ))}
      </div>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-md bg-secondary/60 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{k}</div>
      <div className="text-foreground">{v}</div>
    </div>
  );
}

function Row({ label, value, children }: { label: string; value: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums text-foreground/80">{value}</span>
      </div>
      {children}
    </div>
  );
}
