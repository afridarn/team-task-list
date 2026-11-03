// ---------------------------------------------------------------------------
// Fill in the two values from: Supabase Dashboard > Project Settings > API
//   * Project URL
//   * the PUBLISHABLE key (or the legacy "anon" key)
// Both are designed to be public: the database rules (Row Level Security in
// supabase/schema.sql) decide who can see data, not secrecy of this key.
//
// NEVER put the "secret" or "service_role" key here.
// ---------------------------------------------------------------------------
window.TASKHUB_CONFIG = {
  SUPABASE_URL: 'https://wpkwznpzkiruybdwrbaf.supabase.co',
  SUPABASE_KEY: 'sb_publishable_oFeB5-jSaaW5vWtR6rmaMg_spY5lde2',

  KEEP_SIGNED_IN: true,   // false = sign out when the browser tab is closed
  IDLE_MINUTES: 30,       // automatic sign-out after this many idle minutes
};
