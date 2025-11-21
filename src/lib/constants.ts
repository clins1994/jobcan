// Jobcan API Constants
export const CLIENT_ID = "BhMffo7y3w3pMipg9Q4Z1jERl9LQZLGrtkV1w55e";

// Base URLs
export const ID_BASE_URL = "https://id.jobcan.jp";
export const SSL_BASE_URL = "https://ssl.jobcan.jp";

// Derived URLs
export const REDIRECT_URI = `${SSL_BASE_URL}/jbcoauth/callback`;

// Cache TTL (in milliseconds)
export const CACHE_TTL = {
  ATTENDANCE: 5 * 60 * 1000, // 5 minutes
  SESSION: 24 * 60 * 60 * 1000, // 24 hours (session cookie expiry)
} as const;

// LocalStorage keys
export const STORAGE_KEYS = {
  SESSION_COOKIE: "jobcan_session_cookie",
  SESSION_COOKIES: "jobcan_session_cookies",
  SESSION_EXPIRY: "jobcan_session_expiry",
} as const;
