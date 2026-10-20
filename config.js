// CONFIGURAÇÃO DO SUPABASE (Ambiente Local / Proxy de Testes)
const SUPABASE_REAL_URL = "https://ijavkuwlcascnwnucbgm.supabase.co";
const SUPABASE_URL =
  typeof window !== "undefined" &&
  (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") &&
  window.location.port
    ? window.location.origin
    : SUPABASE_REAL_URL;
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_CJvBm4ZD5q2uz0E8hxf81w_ZiXdHels";
