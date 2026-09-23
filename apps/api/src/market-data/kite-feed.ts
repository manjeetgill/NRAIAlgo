import { Worker } from "node:worker_threads";
import type { ZerodhaInputs } from "../build-overview-snapshot.js";

export type FeedMessage =
  | { type: "state"; state: "connecting" | "streaming" | "reconnecting" | "unavailable"; retryable?: boolean }
  | { type: "indices"; indices: { token: number; instrumentId: string; label: string }[] }
  | { type: "ticks"; ticks: { token: number; price: number; exchangeTime: string | null }[] }
  | { type: "order" };
export interface Feed {
  subscribe(tokens: number[]): void;
  stop(): void;
}
export type FeedFactory = (credentials: ZerodhaInputs, receive: (message: FeedMessage) => void) => Feed;

// kiteconnect 5.3 keeps socket/event-handler state at module scope. Never
// instantiate two accounts' tickers in the same JS isolate. A worker also
// keeps broker credentials and binary parsing entirely outside the browser.
export const KITE_FEED_WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
const send = (message) => parentPort.postMessage(message);
(async () => {
  const { KiteConnect, KiteTicker } = await import(workerData.sdk);
  const client = new KiteConnect({ api_key: workerData.apiKey, timeout: 8000 });
  client.setAccessToken(workerData.accessToken);
  const indices = [
    ['NSE:NIFTY 50', 'NSE:NIFTY50', 'NIFTY 50'],
    ['NSE:NIFTY BANK', 'NSE:BANKNIFTY', 'BANK NIFTY'],
    ['NSE:INDIA VIX', 'NSE:INDIAVIX', 'INDIA VIX'],
  ];
  let ticker;
  let positionTokens = [];
  let indexTokens = [];
  let subscribed = [];
  function update() {
    if (!ticker || !ticker.connected()) return;
    const desired = [...new Set([...indexTokens, ...positionTokens])];
    if (desired.length > 3000) { send({type:'state',state:'unavailable'}); return; }
    const remove = subscribed.filter(token => !desired.includes(token));
    const add = desired.filter(token => !subscribed.includes(token));
    if (remove.length) ticker.unsubscribe(remove);
    if (add.length) { ticker.subscribe(add); ticker.setMode(ticker.modeFull, add); }
    subscribed = desired;
  }
  parentPort.on('message', tokens => { positionTokens = tokens; update(); });
  // This one REST lookup resolves today's instrument tokens. Subsequent
  // prices come from the socket, never quote polling once per second.
  let quotes;
  for (let attempt = 0; attempt < 5; attempt++) {
    try { quotes = await client.getLTP(indices.map(row => row[0])); break; }
    catch (error) {
      if (error && error.error_type === 'TokenException') throw new Error('auth');
      if (attempt === 4) throw new Error('lookup');
      await new Promise(resolve => setTimeout(resolve, Math.min(30000, 2000 * 2 ** attempt)));
    }
  }
  const resolved = indices.map(([key, instrumentId, label]) => {
    const token = quotes[key]?.instrument_token;
    if (!Number.isInteger(token) || token <= 0) throw new Error('missing token');
    return {token, instrumentId, label};
  });
  indexTokens = resolved.map(row => row.token);
  send({type:'indices', indices:resolved});
  ticker = new KiteTicker({api_key:workerData.apiKey, access_token:workerData.accessToken, reconnect:true, max_retry:10, max_delay:30});
  ticker.on('connect', () => { subscribed = []; update(); send({type:'state',state:'streaming'}); send({type:'order'}); });
  ticker.on('ticks', ticks => send({type:'ticks', ticks:ticks.map(tick => ({
    token:tick.instrument_token, price:tick.last_price,
    exchangeTime:tick.exchange_timestamp instanceof Date && Number.isFinite(tick.exchange_timestamp.getTime()) ? tick.exchange_timestamp.toISOString() : null
  }))}));
  for (const event of ['disconnect','close','error','reconnect']) ticker.on(event, () => send({type:'state',state:'reconnecting'}));
  ticker.on('noreconnect', () => send({type:'state',state:'unavailable'}));
  ticker.on('order_update', () => send({type:'order'}));
  ticker.connect();
})().catch(error => send({type:'state',state:'unavailable',retryable:error?.message !== 'auth'}));
`;

const startKiteWorker: FeedFactory = (credentials, receive) => {
  const worker = new Worker(KITE_FEED_WORKER_SOURCE, {
    eval: true,
    workerData: { ...credentials, sdk: import.meta.resolve("kiteconnect") },
    // Do not forward SDK stdout/errors: socket error messages may contain URLs
    // with the access token. Emit a fixed public state instead.
    stdout: true, stderr: true,
  });
  worker.stdout.resume();
  worker.stderr.resume();
  worker.on("message", receive);
  worker.on("error", () => receive({ type: "state", state: "unavailable" }));
  worker.on("exit", () => receive({ type: "state", state: "unavailable" }));
  return {
    subscribe: (tokens) => worker.postMessage(tokens),
    stop: () => { worker.removeAllListeners(); void worker.terminate(); },
  };
};

/** SDK reconnect handles short drops; this supervisor replaces terminal workers.
 * Authentication failures wait for credential rotation, not repeated logins. */
export function createKiteFeed(credentials: ZerodhaInputs, receive: (message: FeedMessage) => void, launch: FeedFactory = startKiteWorker): Feed {
  let stopped = false, generation = 0, attempts = 0;
  let current: Feed | undefined;
  let desired: number[] = [];
  let retry: ReturnType<typeof setTimeout> | undefined;
  let streamingSince: number | undefined;
  function failed(id: number, retryable = true) {
    if (stopped || id !== generation) return;
    generation++; // Ignore buffered messages and duplicate error/exit events.
    current?.stop(); current = undefined;
    receive({ type: "state", state: "unavailable", retryable });
    if (streamingSince !== undefined && Date.now() - streamingSince >= 60_000) attempts = 0;
    streamingSince = undefined;
    if (!retryable || attempts >= 10) return;
    retry = setTimeout(() => { retry = undefined; connect(); }, Math.min(30_000, 1000 * 2 ** attempts++));
    retry.unref?.();
  }
  function connect() {
    if (stopped) return;
    const id = ++generation;
    receive({ type: "state", state: "connecting" });
    try {
      const feed = launch(credentials, message => {
        if (stopped || id !== generation) return;
        if (message.type === "state" && message.state === "unavailable") { failed(id, message.retryable !== false); return; }
        if (message.type === "state") {
          if (message.state === "streaming") streamingSince ??= Date.now();
          else {
            if (streamingSince !== undefined && Date.now() - streamingSince >= 60_000) attempts = 0;
            streamingSince = undefined;
          }
        }
        receive(message);
      });
      if (stopped || id !== generation) { feed.stop(); return; }
      current = feed;
      current.subscribe(desired);
    } catch { failed(id); }
  }
  connect();
  return {
    subscribe(tokens) {
      if (stopped) return;
      desired = [...new Set(tokens)].filter(token => Number.isInteger(token) && token > 0);
      current?.subscribe(desired);
    },
    stop() { stopped = true; generation++; clearTimeout(retry); current?.stop(); current = undefined; },
  };
}
