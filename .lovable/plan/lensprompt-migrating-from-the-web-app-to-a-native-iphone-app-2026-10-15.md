# LensPrompt: Migrating from the web app to a native iPhone app

## Where things stand
- This project is a web app only: TanStack Start, React and TypeScript, mostly in `src/components/LensPrompt.tsx`. It contains no Swift, no Xcode project and no native code.
- The camera uses `getUserMedia`, recording uses `MediaRecorder`, and settings are saved in `localStorage`. Exposure control works through `applyConstraints` where the browser allows it, which mostly means Safari does not. There is no segmentation and no video processing.
- Lovable cannot build, sign or run iOS apps. The native app needs its own repository and its own toolchain.

## What can be reused and what must be rewritten
Reusable (ideas, values and behaviour, not code):
- How the settings work, plus their ranges and defaults: speed 5–200 px/s (default 40), text size 14–72 (30), opacity 20–100% (75%), line spacing 1.0–2.6 (1.6), vertical position 0–60% (12%), brightness 80–140% (100%), mirror on by default for the front camera.
- How auto-scroll works: frame-timed scrolling (pixels per second × time since the last frame), auto-stop at the end, restart, and scrolling that starts when recording starts.
- UI flow: tap to hide controls, script editor with paste and clear, record → preview → save, a dismissible first-use hint, and error messages for blocked permissions.
- Rule: the script overlay never appears in the recorded video.
- Dark, minimal look with frosted-glass panels and one accent colour (these become SwiftUI materials).

Must be rewritten in Swift/SwiftUI:
- Camera capture: `AVCaptureSession`, front/back device switching, exposure via `AVCaptureDevice.setExposureTargetBias` (supported on iPhone, unlike the web version).
- Recording: `AVAssetWriter` (needed because the video is composited), with audio from `AVCaptureAudioDataOutput`. Save with PHPhotoLibrary or share via `ShareLink`.
- Orientation: lock the app to portrait and set the rotation explicitly (`videoRotationAngle` on iOS 17+). This replaces the web-side orientation guard.
- Persistence: `@AppStorage` or `UserDefaults` instead of `localStorage`.
- Teleprompter overlay: a SwiftUI `ScrollView` or a `CADisplayLink`-driven offset, layered over a Metal preview (`MTKView`).
- Permissions: Info.plist keys `NSCameraUsageDescription`, `NSMicrophoneUsageDescription`, `NSPhotoLibraryAddUsageDescription`.

## Segmentation approach (first milestone)
- Recommended: Vision `VNGeneratePersonSegmentationRequest` at `.balanced` quality (iOS 15+), run on each `CVPixelBuffer` from `AVCaptureVideoDataOutput`. Composite with Core Image `CIBlendWithMask` (camera frame, background image, mask scaled to frame size) on a Metal-backed `CIContext`. Render to an `MTKView` and pass the same composited buffer to `AVAssetWriter`.
- Fallbacks and alternatives: `.fast` quality if frames drop; ARKit `personSegmentationWithDepth` is rejected (rear-focused, heavy, poor for selfie recording). Core ML custom models are only worth it if Vision quality falls short.
- iPhone XR (A12, top supported iOS 18): Vision segmentation runs there, but expect about 720p at 30 fps only at `.balanced`/`.fast`. Target 1280x720 at 30 fps first.

## Smallest real-device proof of concept
One SwiftUI screen, front camera only:
1. Live camera → Vision mask → Core Image blend with a bundled background image → Metal preview.
2. A static teleprompter text overlay (preview only) with a speed slider.
3. A record button: `AVAssetWriter` writes the composited video plus mic audio to an .mov file, then saves it to Photos.
4. On-screen FPS counter and per-frame segmentation time.
Success criteria: steady 24–30 fps on the iPhone XR, upright portrait output, audio in sync, and a clip that plays in Photos.

## Building and signing without a Mac
- Write the code in a GitHub repo. Generate the Xcode project with XcodeGen (`project.yml`) to avoid hand-editing project files.
- Build on cloud macOS CI: GitHub Actions macOS runners (simplest), Codemagic or Bitrise. Use fastlane `match` (certificates kept in a private repo) or the CI provider's automatic signing with an App Store Connect API key.
- Get it onto the phone: upload to TestFlight from CI and install the TestFlight app on the iPhone XR. This is the only reliable way to install without a Mac.
- Optional: rent a cloud Mac (MacinCloud, AWS EC2 Mac) for occasional Xcode debugging and Instruments profiling, which CI cannot replace.

## Accounts needed
- Apple ID with an Apple Developer Program membership ($99/yr). TestFlight and CI signing need it; a free account cannot do this without a Mac.
- App Store Connect access: create the app record, the bundle ID and an API key (.p8) for CI.
- GitHub (or Codemagic/Bitrise) account; macOS CI minutes may cost money.

## Risks
- No local debugger: crashes and performance problems can only be seen through TestFlight crash logs and on-screen counters. Budget for a rented Mac when profiling is needed.
- iPhone XR performance: segmentation plus compositing plus encoding may go over the 33 ms per-frame budget. Mitigations: run segmentation at a lower resolution, reuse masks across frames, fall back to `.fast`.
- Mask quality: edge flicker and hair halos at `.fast`. May need temporal smoothing (blending with the previous mask).
- Audio/video sync and orientation with `AVAssetWriter` are easy to get wrong.
- Thermal throttling during long takes.
- CI signing setup is fiddly the first time (certificates, provisioning profiles, keychains on the runner).
- App Review: needs a clear privacy policy and permission explanations. Processing stays on the device.
- Scope: the web app cannot be "converted". The native app is a rewrite, and this Lovable project would at most stay as a marketing or demo site.

## Suggested order
1. Set up the Apple Developer account, App Store Connect app record and API key.
2. Repo with XcodeGen + GitHub Actions + fastlane → empty SwiftUI app installed on the XR through TestFlight.
3. Camera preview with Metal (no segmentation) plus an FPS counter.
4. Vision segmentation + background compositing.
5. `AVAssetWriter` recording to Photos.
6. Port the teleprompter overlay and settings (values above), then exposure/brightness and camera switching.
