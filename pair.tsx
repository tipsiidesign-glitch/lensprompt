import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

const PhoneSender = lazy(() => import("@/components/PhoneSender"));

export const Route = createFileRoute("/pair")({
  validateSearch: (s: Record<string, unknown>) => ({ session: typeof s["session"] === "string" ? (s["session"] as string) : "" }),
  head: () => ({
    meta: [
      { title: "Connect to Desktop — LensPrompt Monitor" },
      { name: "description", content: "Send your iPhone rear camera to your LensPrompt desktop monitor." },
      { property: "og:title", content: "Connect to Desktop — LensPrompt Monitor" },
      { property: "og:description", content: "Pair your iPhone camera with the LensPrompt desktop monitor." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PairPage,
});

function PairPage() {
  const { session } = Route.useSearch();
  const fallback = <div className="flex h-[100dvh] items-center justify-center bg-background text-sm text-muted-foreground">Loading…</div>;
  return (
    <ClientOnly fallback={fallback}>
      <Suspense fallback={fallback}>
        <PhoneSender session={session} />
      </Suspense>
    </ClientOnly>
  );
}
