import { openDatabase, repository } from "./db";
import { createApp, type EventMessage } from "./app";
import { authenticate, authorize } from "./security";
import { isAllowedOrigin } from "./origin";
import { randomBytes } from "node:crypto";
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
let key = process.env.DATA_ENCRYPTION_KEY;
if (process.env.NODE_ENV === "production" && !process.env.APP_ORIGIN?.trim())
  throw Error("APP_ORIGIN is required in production (public HTTPS origin)");
if (!key) {
  if (process.env.NODE_ENV === "production")
    throw Error("DATA_ENCRYPTION_KEY is required in production");
  const keyPath = resolve("./data/development.key");
  mkdirSync("./data", { recursive: true });
  if (!existsSync(keyPath))
    writeFileSync(keyPath, randomBytes(32).toString("hex"), { mode: 0o600 });
  key = readFileSync(keyPath, "utf8").trim();
}
const db = openDatabase(),
  r = repository(db);
type SocketData = {
  raw: string;
  tenant: string;
  company: string;
  user: string;
};
const sockets = new Set<Bun.ServerWebSocket<SocketData>>();
const emit = (event: EventMessage) => {
  for (const ws of sockets) {
    try {
      const u = authenticate(r, ws.data.raw),
        a = authorize(r, u, ws.data.company);
      if (
        event.tenant === a.user.tenant_id &&
        event.company === a.company.id &&
        (!event.user || event.user === a.user.id)
      )
        ws.send(JSON.stringify({ type: event.type, id: event.id }));
    } catch {
      ws.close(1008, "Access revoked");
    }
  }
};
const { app, scheduledJobs } = createApp(db, key, emit);
const server = Bun.serve<SocketData>({
  port: Number(process.env.PORT) || 3000,
  hostname: "0.0.0.0",
  maxRequestBodySize: 6 * 1024 * 1024,
  async fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      try {
        if (!isAllowedOrigin(req.headers.get("origin"), req.url))
          return new Response("Origin denied", { status: 403 });
        const raw =
          req.headers
            .get("cookie")
            ?.match(/(?:^|;\s*)hrm_session=([^;]+)/)?.[1] || "";
        const u = authenticate(r, raw),
          a = authorize(r, u, url.searchParams.get("company") || "");
        if (
          server.upgrade(req, {
            data: {
              raw,
              tenant: u.tenant_id,
              company: a.company.id,
              user: u.id,
            },
          })
        )
          return;
        return new Response("Upgrade failed", { status: 400 });
      } catch {
        return new Response("Access denied", { status: 403 });
      }
    }
    if (url.pathname.startsWith("/api/")) return app.fetch(req);
    if (!["GET", "HEAD"].includes(req.method))
      return new Response("Not found", { status: 404 });
    const pathname = decodeURIComponent(url.pathname),
      relative = pathname.replace(/^\//, "");
    const root = resolve("dist"),
      candidate = resolve(root, relative);
    if (!candidate.startsWith(root + "/") && candidate !== root)
      return new Response("Denied", { status: 403 });
    const file = Bun.file(candidate);
    if (await file.exists())
      return new Response(file, {
        headers: {
          "Cache-Control": pathname.startsWith("/assets/")
            ? "public,max-age=31536000,immutable"
            : "no-cache",
          "X-Content-Type-Options": "nosniff",
        },
      });
    if (pathname.startsWith("/assets/"))
      return new Response("Not found", { status: 404 });
    const index = Bun.file(resolve(root, "index.html"));
    return (await index.exists())
      ? new Response(index, { headers: { "Cache-Control": "no-cache" } })
      : new Response(
          "Run bun run build first. Development UI: bun run dev:ui",
          { status: 503 },
        );
  },
  websocket: {
    open(ws) {
      sockets.add(ws);
    },
    close(ws) {
      sockets.delete(ws);
    },
    message(ws) {
      try {
        const u = authenticate(r, ws.data.raw);
        authorize(r, u, ws.data.company);
        ws.send(JSON.stringify({ type: "pong" }));
      } catch {
        ws.close(1008, "Access revoked");
      }
    },
  },
});
const timer = setInterval(scheduledJobs, 15000);
timer.unref();
const heartbeat = setInterval(() => {
  for (const ws of sockets) {
    try {
      authorize(r, authenticate(r, ws.data.raw), ws.data.company);
    } catch {
      ws.close(1008, "Access revoked");
    }
  }
}, 30000);
heartbeat.unref();
console.log(`NextHRM listening on http://localhost:${server.port}`);
process.on("SIGTERM", () => {
  clearInterval(timer);
  clearInterval(heartbeat);
  server.stop();
  db.close();
  process.exit(0);
});
