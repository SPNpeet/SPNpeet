import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Tailwind-aware className combiner (shadcn convention). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format a numeric-string / number as Thai Baht (฿). */
export function formatMoney(value: string | number, currency = "THB"): string {
  const n = typeof value === "string" ? Number(value) : value;
  return new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);
}

/** Round half-up to 2 decimals and return a fixed string (mirrors the API). */
export function money2(n: number): string {
  return (Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2);
}
