"use client";

/**
 * High-performance barcode scanner.
 *
 * Uses @zxing/browser (ZXing-JS, WASM/Wasm-accelerated decoding) bound to the
 * device's REAR camera (`facingMode: environment`). Decoded barcodes are
 * resolved against the LOCAL IndexedDB catalog for zero-latency, fully-offline
 * scanning — the network is never on the hot path.
 *
 * A short debounce prevents the same physical scan firing repeatedly while the
 * barcode stays in frame.
 */
import * as React from "react";
import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import { DecodeHintType, BarcodeFormat } from "@zxing/library";
import { Camera, CameraOff, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { findByBarcode } from "@/lib/db/catalog";
import type { CachedProduct } from "@/lib/db/dexie";

interface Props {
  onProduct: (product: CachedProduct) => void;
  onUnknown: (barcode: string) => void;
}

const DEBOUNCE_MS = 1200;

function buildReader(): BrowserMultiFormatReader {
  const hints = new Map();
  // Restrict to common retail symbologies for faster, more reliable decoding.
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
    BarcodeFormat.CODE_128,
    BarcodeFormat.CODE_39,
    BarcodeFormat.QR_CODE,
  ]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  return new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 120 });
}

export function BarcodeScanner({ onProduct, onUnknown }: Props) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const controlsRef = React.useRef<IScannerControls | null>(null);
  const lastScanRef = React.useRef<{ code: string; at: number }>({ code: "", at: 0 });

  const [active, setActive] = React.useState(false);
  const [starting, setStarting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const stop = React.useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setActive(false);
  }, []);

  const handleCode = React.useCallback(
    async (raw: string) => {
      const code = raw.trim();
      const now = Date.now();
      if (code === lastScanRef.current.code && now - lastScanRef.current.at < DEBOUNCE_MS) {
        return; // debounce repeated reads of the same barcode
      }
      lastScanRef.current = { code, at: now };

      // Zero-latency local resolution.
      const product = await findByBarcode(code);
      if (product) {
        onProduct(product);
        if (navigator.vibrate) navigator.vibrate(40);
      } else {
        onUnknown(code);
        if (navigator.vibrate) navigator.vibrate([20, 40, 20]);
      }
    },
    [onProduct, onUnknown],
  );

  const start = React.useCallback(async () => {
    setError(null);
    setStarting(true);
    try {
      const reader = buildReader();
      const controls = await reader.decodeFromConstraints(
        { video: { facingMode: { ideal: "environment" } } },
        videoRef.current!,
        (result) => {
          if (result) void handleCode(result.getText());
        },
      );
      controlsRef.current = controls;
      setActive(true);
    } catch (e) {
      setError(
        e instanceof DOMException && e.name === "NotAllowedError"
          ? "Camera permission denied. Enable it in your browser settings."
          : "Unable to access the camera on this device.",
      );
      setActive(false);
    } finally {
      setStarting(false);
    }
  }, [handleCode]);

  // Always release the camera on unmount.
  React.useEffect(() => () => stop(), [stop]);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg border bg-black">
        <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
        {!active && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground">
            {starting ? <Loader2 className="size-8 animate-spin" /> : <CameraOff className="size-8" />}
            <span className="text-sm">{starting ? "Starting camera…" : "Camera off"}</span>
          </div>
        )}
        {active && (
          // Scan reticle overlay.
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-1/3 w-3/4 rounded-lg border-2 border-primary/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.25)]" />
          </div>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {active ? (
        <Button variant="outline" size="lg" onClick={stop}>
          <CameraOff className="mr-2" /> Stop scanning
        </Button>
      ) : (
        <Button size="lg" onClick={start} disabled={starting}>
          {starting ? <Loader2 className="mr-2 animate-spin" /> : <Camera className="mr-2" />}
          Scan barcode
        </Button>
      )}
    </div>
  );
}
