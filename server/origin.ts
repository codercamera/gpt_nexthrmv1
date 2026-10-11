/** Shared CSRF policy for HTTP mutations and WebSocket handshakes. */
export function isAllowedOrigin(
  origin: string | null | undefined,
  requestUrl: string,
  config = {
    appOrigin: process.env.APP_ORIGIN,
    production: process.env.NODE_ENV === "production",
  },
): boolean {
  if (!origin || origin === "null") return false;
  try {
    const request = new URL(requestUrl);
    const expected = new URL(config.appOrigin?.trim() || request.origin);
    // Configuration is an origin, not an application path or credentials.
    if (
      !["http:", "https:"].includes(expected.protocol) ||
      expected.pathname !== "/" ||
      expected.search ||
      expected.hash ||
      expected.username ||
      expected.password
    )
      return false;
    if (origin === expected.origin) return true;
    // Vite's local HMR UI proxies /api and /ws to the Bun server.
    // Never infer trust from forwarded headers or enable this in production.
    const loopback = (host: string) =>
      ["localhost", "127.0.0.1", "[::1]"].includes(host);
    const source = new URL(origin);
    return (
      !config.production &&
      loopback(request.hostname) &&
      loopback(expected.hostname) &&
      loopback(source.hostname) &&
      source.protocol === "http:" &&
      source.port === "5173" &&
      origin === source.origin
    );
  } catch {
    return false;
  }
}
