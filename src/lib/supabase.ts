import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const sharedSpaceId = import.meta.env.VITE_SHARED_SPACE_ID;

export const allowedEmails = (import.meta.env.VITE_ALLOWED_EMAILS ?? "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
export const sharedSpaceIdFromEnv = sharedSpaceId?.trim() || null;

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl as string, supabaseAnonKey as string)
  : null;
