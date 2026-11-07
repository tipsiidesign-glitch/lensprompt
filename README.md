# LensPrompt

**LensPrompt** is a browser-based teleprompter and camera studio. Write or upload a script, keep it scrolling beside the camera view, and record a video while reading naturally.

> **Status:** Live application. Browser support and device-specific behavior vary; see [Known limitations](#known-limitations).

## Features

- **Script teleprompter:** Paste or upload a script and use adjustable scrolling controls.
- **Reading controls:** Adjust scroll speed, text size, opacity, line height, and script position.
- **Camera and microphone:** Request browser camera and microphone access, switch camera facing mode where supported, and toggle microphone capture.
- **Recording and export:** Record from the browser and download the resulting recording.
- **Camera studio tools:** Apply visual filters and presets, with browser capability checks and fallbacks.
- **Background processing:** Optional person segmentation and background replacement using MediaPipe Tasks Vision.
- **Scene analysis:** Inspect a camera frame for visual characteristics and receive scene suggestions.
- **Local persistence:** Script and user settings are stored in browser local storage.

## Technology stack

The repository's application manifest and source imports identify the following stack:

- **Frontend:** React 19, TypeScript
- **Application framework and routing:** TanStack Start, TanStack Router
- **Build tooling:** Vite
- **Computer vision:** MediaPipe Tasks Vision
- **UI and styling:** Tailwind CSS, Radix UI, Lucide
- **Other libraries:** PeerJS, Recharts, React Hook Form, Zod

See [package.json](./package.json) for the complete dependency list.

## Getting started

### Prerequisites

- A current Node.js runtime
- [Bun](https://bun.sh/) (the repository includes `bun.lock`)

### Install dependencies

```bash
bun install
```

### Start the development server

```bash
bun run dev
```

### Build and lint

```bash
bun run build
bun run lint
```

### Run tests

```bash
bun test
```

### Preview the production build

```bash
bun run preview
```

Camera and microphone features require browser permissions and a secure context (for example, localhost or HTTPS).

## Project structure

```text
src/
  components/   Application components and reusable UI
  hooks/        Reusable React hooks
  lib/          Camera, segmentation, filters, pairing, and utility logic
  routes/       TanStack file-based routes
  styles.css    Global styles
  router.tsx    Router configuration
  server.ts     Server entry
  start.ts      Application start configuration
tests/          Automated tests
roadmap.md      Verified fixes and known limitations
```

The app uses TanStack file-based routing. Route files live in `src/routes/`; `src/routes/__root.tsx` provides the root layout. The generated `src/routeTree.gen.ts` file should not be edited manually.

## Known limitations

The current project roadmap documents these limitations:

- Physical iPhone Safari / Windows mirroring has not been verified.
- Native Swift processing is not implemented.
- The Desktop Monitor help/setup experience should not be treated as a verified native or cross-device streaming feature.

Browser camera, canvas, filtering, and segmentation behavior can differ by browser and device. Unsupported paths should use the app's fallbacks rather than being assumed to work everywhere.

## Development notes

- Keep browser capture and compositing in the client-side camera studio.
- The project includes tests for pairing state and person-mask behavior.
- See [roadmap.md](./roadmap.md) for completed fixes and remaining verification work.

## Author

**Khan Kaif**  
GitHub: [@tipsiidesign-glitch](https://github.com/tipsiidesign-glitch)  
LinkedIn: [khankaiff](https://www.linkedin.com/in/khankaiff/)
