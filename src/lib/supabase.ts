import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Missing Supabase environment variables.");
}

const resolvedSupabaseUrl = supabaseUrl;
const resolvedSupabaseAnonKey = supabaseAnonKey;

export const supabase = createClient(resolvedSupabaseUrl, resolvedSupabaseAnonKey);

export function createSupabaseServerClient(accessToken?: string) {
  return createClient(resolvedSupabaseUrl, resolvedSupabaseAnonKey, {
    global: accessToken
      ? {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      : undefined,
  });
}
