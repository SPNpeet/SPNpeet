"use client";

import { Toaster } from "sonner";

/** Global client providers (toasts, future theme/query providers). */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <Toaster position="top-center" richColors closeButton />
    </>
  );
}
