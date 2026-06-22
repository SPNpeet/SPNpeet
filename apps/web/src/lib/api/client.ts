/**
 * Typed client for the Golang Transaction Engine. Attaches the Supabase JWT,
 * surfaces the engine's stable atomic error codes, and distinguishes network
 * failures (retry / queue offline) from business failures (do NOT retry).
 */
import { env } from "@/lib/env";
import { getAccessToken } from "@/lib/supabase/client";

export interface ApiProduct {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  category: string;
  price: string;
  tax_rate: string;
  is_active: boolean;
  quantity: number;
  updated_at: string;
}

export interface CheckoutItemPayload {
  product_id: string;
  quantity: number;
}

export interface CheckoutPayload {
  client_uuid: string;
  cashier_id?: string;
  items: CheckoutItemPayload[];
  sold_at?: string;
}

export interface OrderResult {
  id: string;
  order_number: number;
  client_uuid: string;
  status: string;
  subtotal: string;
  tax_total: string;
  total: string;
  sold_at: string;
  idempotent: boolean;
}

/** Stable engine error codes (mirror apps/api/internal/domain/errors.go). */
export type ApiErrorCode =
  | "EMPTY_CART"
  | "INVALID_QUANTITY"
  | "PRODUCT_NOT_FOUND"
  | "INSUFFICIENT_STOCK"
  | "LOCK_TIMEOUT"
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "INTERNAL_ERROR"
  | "NETWORK_ERROR";

export class ApiError extends Error {
  code: ApiErrorCode;
  productId?: string;
  /** True when the failure is transport-level (offline) — safe to queue/retry. */
  isNetwork: boolean;
  /** True when the server signalled a transient, retryable condition. */
  isRetryable: boolean;

  constructor(code: ApiErrorCode, message: string, opts?: { productId?: string; isNetwork?: boolean; isRetryable?: boolean }) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.productId = opts?.productId;
    this.isNetwork = opts?.isNetwork ?? false;
    this.isRetryable = opts?.isRetryable ?? code === "LOCK_TIMEOUT";
  }
}

async function authHeaders(): Promise<HeadersInit> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = await getAccessToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

const BASE = `${env.apiUrl.replace(/\/$/, "")}/api/v1`;

/** Fetch the full active catalog (used to warm the offline cache). */
export async function fetchProducts(signal?: AbortSignal): Promise<ApiProduct[]> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/products`, { headers: await authHeaders(), signal });
  } catch {
    throw new ApiError("NETWORK_ERROR", "could not reach the catalog service", { isNetwork: true, isRetryable: true });
  }
  if (!res.ok) throw await toApiError(res);
  const body = (await res.json()) as { products: ApiProduct[] };
  return body.products ?? [];
}

/** Submit a checkout to the engine. Throws ApiError on any failure. */
export async function postCheckout(payload: CheckoutPayload): Promise<OrderResult> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/checkout`, {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify(payload),
    });
  } catch {
    // Transport failure => the device is offline (or server unreachable).
    throw new ApiError("NETWORK_ERROR", "offline: checkout will be queued", { isNetwork: true, isRetryable: true });
  }
  if (!res.ok) throw await toApiError(res);
  const body = (await res.json()) as { order: OrderResult };
  return body.order;
}

async function toApiError(res: Response): Promise<ApiError> {
  let code: ApiErrorCode = "INTERNAL_ERROR";
  let message = `request failed (${res.status})`;
  let productId: string | undefined;
  try {
    const body = (await res.json()) as { error?: { code?: ApiErrorCode; message?: string; product_id?: string } };
    if (body.error) {
      code = body.error.code ?? code;
      message = body.error.message ?? message;
      productId = body.error.product_id;
    }
  } catch {
    /* non-JSON error body */
  }
  // 503 (lock timeout) and 5xx are retryable; 4xx business errors are not.
  const isRetryable = code === "LOCK_TIMEOUT" || res.status >= 500;
  return new ApiError(code, message, { productId, isRetryable });
}
