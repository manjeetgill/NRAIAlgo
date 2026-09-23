import type { FastifyInstance } from "fastify";
import type { Store } from "../database/database.js";
import { AlphaWire } from "../alpha-wire.js";
import { MultiSourceWire } from "../multi-source-wire.js";
import { resolveSession, SESSION_COOKIE_NAME } from "../auth.js";
import { requireAuth } from "./auth.js";

export function alphaWireRoutes(store: Store, wire: AlphaWire = new MultiSourceWire(store)) {
  return async (app: FastifyInstance) => {
    const connections = new Set<() => void>();
    app.addHook("onListen", async () => { wire.start(); });
    app.addHook("preClose", async () => { wire.close(); for (const close of [...connections]) close(); });
    app.addHook("onClose", async () => wire.close());
    app.addHook("preHandler", requireAuth(store));
    app.get("/v1/alpha-wire", async (_request, reply) => {
      reply.header("Cache-Control", "no-store, private");
      return wire.snapshot();
    });
    app.get("/v1/alpha-wire/stream", async (request, reply) => {
      if (connections.size >= 100) return reply.code(503).send({ message: "News stream capacity reached." });
      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store, no-transform, private", "X-Accel-Buffering": "no", Connection: "keep-alive" });
      raw.flushHeaders();
      let stopped = false; let busy = false;
      const close = () => { if (stopped) return; stopped = true; clearInterval(heartbeat); unsubscribe(); connections.delete(close); raw.end(); };
      // Full bounded snapshots on connect/reconnect repair missed recent items without
      // trusting client cursors or exposing any other user's account events.
      const send = async () => {
        if (stopped || busy) return;
        busy = true;
        try {
          const token = request.cookies[SESSION_COOKIE_NAME];
          if (!token || !await resolveSession(store, token)) { close(); return; }
          const snapshot = await wire.snapshot();
          if (!stopped) {
            if (raw.writableLength > 512_000) close();
            else raw.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
          }
        } catch { close(); }
        finally { busy = false; }
      };
      const unsubscribe = wire.subscribe(() => { void send(); });
      const heartbeat = setInterval(() => { void send(); }, 15_000);
      heartbeat.unref(); connections.add(close);
      raw.on("close", close);
      raw.write("retry: 5000\n\n");
      void send();
    });
  };
}
