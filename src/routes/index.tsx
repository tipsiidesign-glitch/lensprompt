import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

const LensPrompt = lazy(() => import("@/components/LensPrompt"));

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "LensPrompt — Teleprompter Camera in Your Browser" },
      {
        name: "description",
        content:
          "Record straight to camera with a smooth scrolling script overlay. No install, no account — just open, paste your script and hit record.",
      },
      { property: "og:title", content: "LensPrompt — Teleprompter Camera in Your Browser" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      {
        property: "og:description",
        content:
          "A browser teleprompter with live camera, adjustable scroll speed and one-tap recording.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <ClientOnly
      fallback={
        <div className="flex h-[100dvh] items-center justify-center bg-background text-sm text-muted-foreground">
          Loading LensPrompt…
        </div>
      }
    >
      <Suspense
        fallback={
          <div className="flex h-[100dvh] items-center justify-center bg-background text-sm text-muted-foreground">
            Loading LensPrompt…
          </div>
        }
      >
        <LensPrompt />
      </Suspense>
    </ClientOnly>
  );
}
