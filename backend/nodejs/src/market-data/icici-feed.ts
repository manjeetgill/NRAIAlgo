import { request } from "node:https";
import AdmZip from "adm-zip";
import { parse } from "csv-parse/sync";
import { io, type Socket } from "socket.io-client";
import type { z } from "zod";
import type { iciciSession } from "../broker-auth/icici.js";

const LIVE_URL = "https://livestream.icicidirect.com";
const MASTER_URL = "https://directlink.icicidirect.com/MotherAppMaster/SecurityMaster.zip";
const MASTER_TTL_MS = 12 * 60 * 60_000;
const MAX_MASTER_BYTES = 30_000_000;

export type IciciSession = z.infer<typeof iciciSession>;
export type IciciInstrument = {
  key: string;
  exchangeCode: string;
  stockCode: string;
  productType: string;
  expiryDate: string;
  strikePrice: string;
  right: string;
};
export type IciciFeedMessage =
  | { type: "state"; state: "connecting" | "streaming" | "reconnecting" | "unavailable" }
  | { type: "tick"; key: string; price: number; previousClose: number | null; sourceAt: number };
export type IciciFeed = { subscribe(instruments: IciciInstrument[]): void; stop(): void };
export type IciciFeedFactory = (session: IciciSession, receive: (message: IciciFeedMessage) => void) => IciciFeed;

type Master = Map<string, { token: string; prefix: string }>;
let masterCache: { until: number; pending: Promise<Master> } | undefined;

function clean(value: unknown): string { return String(value ?? "").replaceAll('"', "").trim(); }
function canonicalExpiry(value: unknown): string {
  const text = clean(value).toUpperCase();
  const iso = /^(\d{4})[-/]?(\d{2})[-/]?(\d{2})$/.exec(text);
  if (iso) return `${iso[1]}${iso[2]}${iso[3]}`;
  const named = /^(\d{1,2})[-/ ]([A-Z]{3})[-/ ](\d{4})$/.exec(text);
  const months: Record<string, string> = { JAN:"01",FEB:"02",MAR:"03",APR:"04",MAY:"05",JUN:"06",JUL:"07",AUG:"08",SEP:"09",OCT:"10",NOV:"11",DEC:"12" };
  if (named && months[named[2]!]) return `${named[3]}${months[named[2]!]}${named[1]!.padStart(2,"0")}`;
  return text.replace(/[^A-Z0-9]/g, "");
}
function canonicalStrike(value: unknown): string {
  const numeric = Number(clean(value));
  return Number.isFinite(numeric) ? String(numeric) : clean(value).toUpperCase();
}
function product(value: unknown): "FUT" | "OPT" | "" {
  const text = clean(value).toUpperCase();
  return text.includes("FUT") ? "FUT" : text.includes("OPT") ? "OPT" : "";
}
function optionRight(value: unknown): "CE" | "PE" | "" {
  const text = clean(value).toUpperCase();
  return text === "CALL" || text === "CE" ? "CE" : text === "PUT" || text === "PE" ? "PE" : "";
}
export function instrumentLookupKey(instrument: Omit<IciciInstrument, "key">): string {
  const exchange = clean(instrument.exchangeCode).toUpperCase();
  const stock = clean(instrument.stockCode).toUpperCase();
  if (exchange === "NSE" || exchange === "BSE") return `${exchange}|${stock}`;
  const kind = product(instrument.productType);
  return `${exchange}|${stock}|${kind}|${canonicalExpiry(instrument.expiryDate)}|${kind === "OPT" ? canonicalStrike(instrument.strikePrice) : ""}|${kind === "OPT" ? optionRight(instrument.right) : ""}`;
}

// Only the official ICICI Direct domain, over HTTPS: a redirect must stay
// inside the same trusted host family, never follow an attacker- or
// misconfigured-server-supplied location to an arbitrary host.
function safeMasterRedirect(location: string, from: string): string | null {
  try {
    const url = new URL(location, from);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (!/(^|\.)icicidirect\.com$/i.test(url.hostname)) return null;
    return url.href;
  } catch { return null; }
}

function download(url: string, redirectsLeft = 5): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: "GET" }, response => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        if (redirectsLeft <= 0) { reject(new Error("ICICI security master redirected too many times")); return; }
        const next = safeMasterRedirect(response.headers.location, url);
        if (!next) { reject(new Error("ICICI security master redirected to an untrusted location")); return; }
        download(next, redirectsLeft - 1).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) { response.resume(); reject(new Error("ICICI security master unavailable")); return; }
      const chunks: Buffer[] = []; let size = 0;
      response.on("data", (chunk: Buffer) => { size += chunk.length; if (size > MAX_MASTER_BYTES) req.destroy(new Error("ICICI security master too large")); else chunks.push(chunk); });
      response.on("end", () => resolve(Buffer.concat(chunks)));
      response.on("error", reject);
    });
    req.setTimeout(30_000, () => req.destroy(new Error("ICICI security master timed out")));
    req.on("error", reject); req.end();
  });
}

export function parseSecurityMaster(buffer: Buffer): Master {
  const result: Master = new Map();
  for (const entry of new AdmZip(buffer).getEntries()) {
    const name = entry.entryName.toUpperCase();
    if (!name.endsWith(".TXT")) continue;
    const exchange = name.includes("FONSE") ? "NFO" : name.includes("FOBSE") ? "BFO" : name.includes("NSE") ? "NSE" : name.includes("BSE") ? "BSE" : null;
    if (!exchange) continue;
    const prefix = exchange === "BSE" ? "1." : exchange === "BFO" ? "8." : "4.";
    const rows = parse(entry.getData().toString("utf8").replaceAll("\r", ""), { relax_column_count: true, skip_empty_lines: true, relax_quotes: true }) as unknown[][];
    for (const columns of rows) {
      const token = clean(columns[0]);
      if (!/^\d+$/.test(token)) continue;
      if (exchange === "NSE" || exchange === "BSE") {
        const stockCode = clean(columns[1] || columns[3]).toUpperCase();
        if (stockCode) result.set(`${exchange}|${stockCode}`, { token, prefix });
      } else {
        const kind = product(columns[3]);
        const stockCode = clean(columns[2]).toUpperCase();
        if (!kind || !stockCode) continue;
        const key = `${exchange}|${stockCode}|${kind}|${canonicalExpiry(columns[4])}|${kind === "OPT" ? canonicalStrike(columns[5]) : ""}|${kind === "OPT" ? optionRight(columns[6]) : ""}`;
        result.set(key, { token, prefix });
      }
    }
  }
  if (!result.size) throw new Error("ICICI security master was empty");
  return result;
}

async function securityMaster(): Promise<Master> {
  const now = Date.now();
  if (masterCache && masterCache.until > now) return masterCache.pending;
  const pending = download(MASTER_URL).then(parseSecurityMaster);
  masterCache = { until: now + MASTER_TTL_MS, pending };
  try { return await pending; }
  catch (error) { if (masterCache?.pending === pending) masterCache = undefined; throw error; }
}

function socketCredentials(session: IciciSession): { user: string; token: string } {
  const decoded = Buffer.from(session.sessionToken, "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  const user = decoded.slice(0, separator); const token = decoded.slice(separator + 1);
  if (separator < 1 || !user || !token || user !== session.accountId) throw new Error("Invalid ICICI live session");
  return { user, token };
}

export function parseIciciTick(value: unknown, tokenKeys: Map<string, string>, now = Date.now()): IciciFeedMessage | null {
  if (!Array.isArray(value) || typeof value[0] !== "string" || !value[0].includes(".1!")) return null;
  const key = tokenKeys.get(value[0]);
  const price = Number(value[2]);
  if (!key || !Number.isFinite(price) || price <= 0) return null;
  const sourceSeconds = Number(value.length === 23 ? value[21] : value.length === 21 ? value[19] : NaN);
  const sourceAt = Number.isFinite(sourceSeconds) && sourceSeconds > 0 ? sourceSeconds * 1000 : now;
  const closeIndex = value.length === 23 ? 22 : value.length === 21 ? 20 : -1;
  const rawClose = closeIndex >= 0 ? Number(value[closeIndex]) : NaN;
  const previousClose = Number.isFinite(rawClose) && rawClose > 0 ? rawClose : null;
  if (sourceAt > now + 5_000 || sourceAt < now - 86_400_000) return null;
  return { type: "tick", key, price, previousClose, sourceAt };
}

export const createIciciFeed: IciciFeedFactory = (session, receive) => {
  let socket: Socket | undefined; let stopped = false; let desired: IciciInstrument[] = [];
  const joined = new Set<string>(); const tokenKeys = new Map<string, string>();
  receive({ type: "state", state: "connecting" });
  const ready = securityMaster().then(master => {
    if (stopped) return;
    const auth = socketCredentials(session);
    socket = io(LIVE_URL, { auth, transports: ["websocket"], extraHeaders: { "User-Agent": "node-socketio[client]/socket" }, reconnection: true, reconnectionDelay: 1000, reconnectionDelayMax: 10_000, timeout: 15_000 });
    const sync = () => {
      if (!socket?.connected) return;
      const next = new Map<string, string>();
      for (const instrument of desired) {
        const match = master.get(instrumentLookupKey(instrument));
        if (match) next.set(`${match.prefix}1!${match.token}`, instrument.key);
      }
      for (const token of joined) if (!next.has(token)) { socket.emit("leave", token); joined.delete(token); tokenKeys.delete(token); }
      for (const [token, key] of next) { tokenKeys.set(token, key); if (!joined.has(token)) { socket.emit("join", token); joined.add(token); } }
    };
    socket.on("connect", () => { joined.clear(); receive({ type: "state", state: "streaming" }); sync(); });
    socket.on("disconnect", () => { if (!stopped) receive({ type: "state", state: "reconnecting" }); });
    socket.on("connect_error", () => { if (!stopped) receive({ type: "state", state: "reconnecting" }); });
    socket.on("stock", value => { const tick = parseIciciTick(value, tokenKeys); if (tick) receive(tick); });
    return sync;
  }).catch(() => { if (!stopped) receive({ type: "state", state: "unavailable" }); return undefined; });
  return {
    subscribe(instruments) { desired = instruments.slice(0, 500); void ready.then(sync => sync?.()); },
    stop() { stopped = true; socket?.removeAllListeners(); socket?.disconnect(); },
  };
};
