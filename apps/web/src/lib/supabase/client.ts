/**
 * Browser-side Supabase client (Auth + realtime). Used for staff login and to
 * obtain the JWT that authorizes calls to the Golang Transaction Engine.
 *
 * If Supabase isn't configured (local dev without a project), this returns null
 * and the app falls back to an unauthenticated dev flow.
 */
"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { env, isSupabaseConfigured } from "@/lib/env";

let _client: SupabaseClient | null = null;

export function supabase(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null;
  if (typeof window === "undefined") return null;
  if (!_client) {
    _client = createBrowserClient(env.supabaseUrl, env.supabaseAnonKey);
  }
  return _client;
}

/** Returns the current access token (JWT) or null if not signed in. */
export async function getAccessToken(): Promise<string | null> {
  const sb = supabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session?.access_token ?? null;
}

/** Returns the current user id or null. */
export async function getUserId(): Promise<string | null> {
  const sb = supabase();
  if (!sb) return null;
  const { data } = await sb.auth.getUser();
  return data.user?.id ?? null;
}
