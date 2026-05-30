import { CloudOff } from "lucide-react";

/** Shown by the service worker when a navigation is attempted while offline
 *  and the requested route isn't cached. The POS itself works offline. */
export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-slate-950 p-6 text-center text-slate-200">
      <CloudOff className="size-10 text-sky-400" />
      <h1 className="text-xl font-semibold">You&apos;re offline</h1>
      <p className="max-w-sm text-sm text-slate-400">
        This page isn&apos;t cached yet. The register at <span className="font-mono">/pos</span> keeps
        working offline and will sync your sales when you reconnect.
      </p>
    </main>
  );
}
