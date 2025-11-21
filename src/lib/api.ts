import { ensureValidSession, clearStoredSession, getSessionCookies } from "./auth";
import { AttendanceResponse } from "./types";
import { SSL_BASE_URL } from "./constants";
import { parseAttendanceHtml } from "./parse-attendance";

/**
 * Get default headers for API requests
 */
async function getDefaultHeaders(): Promise<Record<string, string>> {
  await ensureValidSession(); // Ensure session is valid
  const cookies = await getSessionCookies(); // Get all cookies

  return {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    Cookie: cookies,
    Referer: `${SSL_BASE_URL}/employee`,
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
  };
}


/**
 * Get attendance data for a specific month
 */
export async function getAttendance(year?: number, month?: number): Promise<AttendanceResponse> {
  const now = new Date();
  const targetYear = year || now.getFullYear();
  const targetMonth = month || now.getMonth() + 1;

  const headers = await getDefaultHeaders();

  // Calculate first and last day of the month
  const firstDay = 1;
  const lastDay = new Date(targetYear, targetMonth, 0).getDate(); // Get last day of month

  // Build URL with query parameters
  const params = new URLSearchParams({
    list_type: "normal",
    search_type: "month",
    month: String(targetMonth),
    year: String(targetYear),
    "from[m]": String(targetMonth),
    "from[d]": String(firstDay),
    "from[y]": String(targetYear),
    "to[m]": String(targetMonth),
    "to[d]": String(lastDay),
    "to[y]": String(targetYear),
  });

  const url = `${SSL_BASE_URL}/employee/attendance?${params.toString()}`;

  const response = await fetch(url, {
    method: "GET",
    headers,
  });

  const html = await response.text();
  
  // Check if response is a login page (even if status is 200)
  const isLoginPage = html.includes("sign_in") || html.includes("ログイン") || html.includes("login") || !html.includes("jbc-table");
  
  if (response.status === 401 || response.status === 403 || isLoginPage) {
    console.debug(`[API] ${response.status === 401 || response.status === 403 ? `${response.status} Unauthorized` : "Login page detected"} - Session may have expired`);
    // Try to refresh session and retry
    try {
      console.debug(`[API] Attempting to re-authenticate...`);
      // Clear the invalid session and force a fresh login
      await clearStoredSession();
      console.debug(`[API] Cleared invalid session, forcing fresh login`);
      const newSid = await ensureValidSession();
      console.debug(`[API] Re-authenticated, got new sid: ${newSid.substring(0, 10)}...`);
      const newHeaders = await getDefaultHeaders();
      const retryResponse = await fetch(url, {
        method: "GET",
        headers: newHeaders,
      });

      if (!retryResponse.ok) {
        throw new Error(`API request failed: ${retryResponse.status} ${retryResponse.statusText}`);
      }

      const retryHtml = await retryResponse.text();
      
      // Check if still a login page
      if (retryHtml.includes("sign_in") || retryHtml.includes("ログイン") || !retryHtml.includes("jbc-table")) {
        throw new Error("Session appears to be invalid. Please check your credentials and try logging in again.");
      }
      
      const result = parseAttendanceHtml(retryHtml, targetYear, targetMonth);
      return result;
    } catch (error) {
      console.debug(`[API] Authentication failed for ${url}: ${error}`);
      throw new Error(`Authentication failed: ${error instanceof Error ? error.message : "Unknown error"}. Please check your credentials.`);
    }
  }

  if (!response.ok) {
    const errorText = await response.text();
    console.debug(`[API] GET ${url} - Error ${response.status}: ${errorText.substring(0, 200)}`);
    throw new Error(`API request failed: ${response.status} ${errorText}`);
  }

  // Check for error messages
  if (html.includes("error") || html.includes("Error") || html.includes("エラー")) {
    const errorMatch = html.match(/<[^>]*error[^>]*>([^<]+)/i);
    if (errorMatch) {
      console.debug(`[API] Error text found: ${errorMatch[1]}`);
    }
  }
  
  const result = parseAttendanceHtml(html, targetYear, targetMonth);
  return result;
}

