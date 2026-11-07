# LensPrompt

A browser-based teleprompter and camera-recording application. Upload a script, display it as a live scrolling layer, and record yourself while reading directly in front of the screen.

> **Project status:** Live application. Some platform-specific capabilities remain unverified or unimplemented; see the limitations section below.

## What it does

- **Script upload:** Bring your own script into the teleprompter.
- **Live scrolling:** Read from a scrolling on-screen script layer while recording.
- **Camera access:** Grant browser camera permission and record yourself.
- **Recording workflows:** Supports recording with or without the script overlay, according to the current project roadmap.
- **Visual processing:** The codebase includes person-mask and compositing workflows, with transparent-image handling and unsupported-feature fallbacks documented in the roadmap.

## Technology

The current project manifest identifies this as a TypeScript/React application built with:

- React 19 and TypeScript
- TanStack Start / TanStack Router
- Vite
- MediaPipe Tasks Vision
- Tailwind CSS
- Radix UI components

See `package.json` for the full dependency list.

## Run locally

Prerequisites: a recent Node.js runtime and Bun (the repository includes `bun.lock`).

```bash
bun install
bun run dev
```

Build and check the project:

```bash
bun run build
bun run lint
```

Preview a production build:

```bash
bun run preview
```

## Repository structure

- `src/` — application source and routes
- `tests/` — automated tests
- `roadmap.md` — implementation status and known limitations
- `package.json` — scripts and dependencies

This project uses TanStack Start file-based routing. Route files live under `src/routes/`; the root layout is `src/routes/__root.tsx`. The generated route tree should not be edited manually.

## Current limitations

The project roadmap explicitly notes that:

- Physical iPhone Safari / Windows mirroring has not been verified.
- Native Swift processing is not implemented.
- Desktop Monitor is setup guidance only; it does not provide network streaming or device pairing.

These limitations are intentionally stated rather than represented as working features.

## Project status

See [roadmap.md](./roadmap.md) for tested workflows, completed fixes, and remaining limitations.

## Author

**Khan Kaif**  
GitHub: [@tipsiidesign-glitch](https://github.com/tipsiidesign-glitch)  
LinkedIn: [khankaiff](https://www.linkedin.com/in/khankaiff/)
