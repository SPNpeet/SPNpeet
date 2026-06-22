"use client";

import { useEffect, useState, useCallback } from "react";

import { onSyncChange, processQueue, queueStats, pruneSynced, type QueueStats } from "@/lib/sync/engine";
import { useOnline } from "./use-online";

const POLL_MS = 20_000;

/**
 * Wires the sync engine to the React tree:
 *  - exposes live queue stats
 *  - drains the queue on reconnect, on focus, and on an interval
 */
export function useSync() {
  const online = useOnline();
  const [stats, setStats] = useState<QueueStats>({ queued: 0, syncing: 0, error: 0, synced: 0 });

  const refresh = useCallback(async () => {
    setStats(await queueStats());
  }, []);

  // Live updates whenever the engine mutates the queue.
  useEffect(() => {
    const off = onSyncChange(() => void refresh());
    void refresh();
    return off;
  }, [refresh]);

  // Drain on reconnect.
  useEffect(() => {
    if (online) void processQueue();
  }, [online]);

  // Safety-net interval + prune + drain on focus/visibility.
  useEffect(() => {
    const tick = () => {
      void processQueue();
      void pruneSynced();
    };
    const id = window.setInterval(tick, POLL_MS);
    const onFocus = () => void processQueue();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

  return { online, stats, refresh };
}
