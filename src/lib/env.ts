/** Public configuration. Both values are safe to ship to the browser. */
export const env = {
  supabaseUrl: (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ?? '',
  supabaseKey: (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim() ?? '',
};

export const isConfigured = Boolean(env.supabaseUrl && env.supabaseKey);
