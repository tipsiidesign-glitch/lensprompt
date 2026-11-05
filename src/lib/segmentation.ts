import type { ImageSegmenter } from "@mediapipe/tasks-vision";

// Free, on-device MediaPipe selfie segmenter. Runtime + model files are fetched once from public CDNs; no API key.
const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm";
const MODEL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite";

export async function createSegmenter(): Promise<ImageSegmenter> {
  if (typeof WebAssembly === "undefined") throw new Error("WebAssembly is not available in this browser.");
  const { FilesetResolver, ImageSegmenter } = await import("@mediapipe/tasks-vision");
  const fileset = await FilesetResolver.forVisionTasks(WASM);
  const opts = (delegate: "GPU" | "CPU") => ({
    baseOptions: { modelAssetPath: MODEL, delegate },
    runningMode: "VIDEO" as const,
    outputCategoryMask: false,
    outputConfidenceMasks: true,
  });
  try {
    return await ImageSegmenter.createFromOptions(fileset, opts("GPU"));
  } catch {
    return await ImageSegmenter.createFromOptions(fileset, opts("CPU"));
  }
}
