"use client";

import { Cloud, CloudOff, RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { processQueue, type QueueStats } from "@/lib/sync/engine";

interface Props {
  online: boolean;
  stats: QueueStats;
}

/** Compact connectivity + sync-queue status pill for the POS header. */
export function SyncIndicator({ online, stats }: Props) {
  const pending = stats.queued + stats.syncing;

  return (
    <div className="flex items-center gap-2">
      <Badge variant={online ? "success" : "warning"} className="gap-1">
        {online ? <Cloud className="size-3.5" /> : <CloudOff className="size-3.5" />}
        {online ? "Online" : "Offline"}
      </Badge>

      {pending > 0 && (
        <Badge variant="secondary" className="gap-1">
          <RefreshCw className={cn("size-3.5", stats.syncing > 0 && "animate-spin")} />
          {pending} pending
        </Badge>
      )}

      {stats.error > 0 && (
        <Badge variant="destructive" className="gap-1">
          <AlertTriangle className="size-3.5" />
          {stats.error} failed
        </Badge>
      )}

      {pending === 0 && stats.error === 0 && stats.synced > 0 && (
        <Badge variant="outline" className="gap-1 text-emerald-600">
          <CheckCircle2 className="size-3.5" />
          Synced
        </Badge>
      )}

      {online && pending > 0 && (
        <Button variant="ghost" size="sm" onClick={() => void processQueue()}>
          Sync now
        </Button>
      )}
    </div>
  );
}
