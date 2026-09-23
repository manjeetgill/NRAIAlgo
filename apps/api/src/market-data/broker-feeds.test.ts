import { Worker } from "node:worker_threads";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createKiteFeed, KITE_FEED_WORKER_SOURCE, type FeedMessage } from "./kite-feed.js";
import { createKotakFeed } from "./kotak-feed.js";
import type { startKotakSdk } from "../broker-auth/kotak-sdk.js";

afterEach(() => vi.useRealTimers());

describe("Kite terminal worker recovery", () => {
  it("replaces failed workers with bounded backoff, restores subscriptions, and rejects old events", () => {
    vi.useFakeTimers();
    const workers: { receive: (message: FeedMessage) => void; stop: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn> }[] = [];
    const receive = vi.fn();
    const feed = createKiteFeed({apiKey: "k", accessToken: "t", accountId: "A"}, receive, (_credentials, callback) => {
      const worker = { receive: callback, stop: vi.fn(), subscribe: vi.fn() }; workers.push(worker); return worker;
    });
    feed.subscribe([123]);
    workers[0]!.receive({type: "state", state: "unavailable"});
    workers[0]!.receive({type: "state", state: "unavailable"});
    vi.advanceTimersByTime(1000);
    expect(workers).toHaveLength(2);
    expect(workers[1]!.subscribe).toHaveBeenLastCalledWith([123]);
    receive.mockClear();
    workers[0]!.receive({type: "order"});
    expect(receive).not.toHaveBeenCalled();
    workers[1]!.receive({type: "state", state: "unavailable"});
    vi.advanceTimersByTime(1999); expect(workers).toHaveLength(2);
    vi.advanceTimersByTime(1); expect(workers).toHaveLength(3);
    workers[2]!.receive({type: "state", state: "unavailable"});
    feed.stop(); vi.advanceTimersByTime(60000);
    expect(workers).toHaveLength(3);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not retry invalid credentials", () => {
    vi.useFakeTimers(); let receive: (m: FeedMessage) => void = () => {};
    const launch = vi.fn((_credentials, callback) => { receive = callback; return {subscribe: vi.fn(), stop: vi.fn()}; });
    const feed = createKiteFeed({apiKey: "k", accessToken: "t", accountId: "A"}, vi.fn(), launch);
    receive({type:"state",state:"unavailable",retryable:false});
    vi.advanceTimersByTime(600000); expect(launch).toHaveBeenCalledOnce(); feed.stop();
  });
  it("caps repeated startup failures even while the workspace stays active", () => {
    vi.useFakeTimers(); let receive: (m: FeedMessage) => void = () => {};
    const launch = vi.fn((_credentials, callback) => { receive = callback; return {subscribe: vi.fn(), stop: vi.fn()}; });
    const feed = createKiteFeed({apiKey: "k", accessToken: "t", accountId: "A"}, vi.fn(), launch);
    for (let i = 0; i < 20; i++) { receive({type:"state",state:"unavailable"}); vi.advanceTimersByTime(30000); }
    expect(launch).toHaveBeenCalledTimes(11); feed.stop();
  });
  it("resets the restart budget after a stable connection, including a normal disconnect event", () => {
    vi.useFakeTimers(); let receive: (m: FeedMessage) => void = () => {};
    const launch = vi.fn((_credentials, callback) => { receive = callback; return {subscribe: vi.fn(), stop: vi.fn()}; });
    const feed = createKiteFeed({apiKey: "k", accessToken: "t", accountId: "A"}, vi.fn(), launch);
    for (let i = 0; i < 12; i++) {
      receive({type:"state",state:"streaming"});vi.advanceTimersByTime(60000);
      receive({type:"state",state:"reconnecting"});receive({type:"state",state:"unavailable"});
      vi.advanceTimersByTime(1000);
    }
    expect(launch).toHaveBeenCalledTimes(13);feed.stop();
  });
});

describe("Kite feed worker bootstrap", () => {
  it("allows a normal REST round trip before connecting and delivering ticks", async () => {
    // Exercise the actual worker source, not a mocked FeedFactory. The SDK
    // timeout unit is milliseconds; 8 ms must fail this regression test.
    const sdk = `
      export class KiteConnect {
        constructor(options) { this.timeout = options.timeout; }
        setAccessToken() {}
        async getLTP(keys) {
          if (this.timeout < 1000) throw {error_type:'TokenException'};
          await new Promise(resolve => setTimeout(resolve, 30));
          return Object.fromEntries(keys.map((key, i) => [key, {instrument_token:i+1}]));
        }
      }
      export class KiteTicker {
        handlers = {}; modeFull = 'full';
        on(event, callback) { this.handlers[event] = callback; }
        connected() { return true; }
        subscribe(tokens) { this.tokens = tokens; }
        unsubscribe() {}
        setMode() {}
        connect() {
          this.handlers.connect();
          this.handlers.ticks(this.tokens.map(token => ({instrument_token:token,last_price:100+token,exchange_timestamp:new Date()})));
        }
      }
    `;
    const messages: FeedMessage[] = [];
    const worker = new Worker(KITE_FEED_WORKER_SOURCE, { eval: true, workerData: {
      apiKey: "test", accessToken: "test", sdk: `data:text/javascript;base64,${Buffer.from(sdk).toString("base64")}`,
    } });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Worker did not deliver ticks")), 4000);
        worker.on("error", reject);
        worker.on("message", (message: FeedMessage) => {
          messages.push(message);
          if (message.type === "state" && message.state === "unavailable") reject(new Error("Worker initialization failed"));
          if (message.type === "ticks") resolve();
        });
      });
      expect(messages).toContainEqual({ type: "state", state: "streaming" });
      expect(messages.find(message => message.type === "ticks")).toMatchObject({ type: "ticks", ticks: [{ token: 1, price: 101 }, { token: 2, price: 102 }, { token: 3, price: 103 }] });
    } finally {
      clearTimeout(timer);
      await worker.terminate();
    }
  });
});

describe('Kotak SDK feed bridge',()=>{
  it('resets the budget only after both channels are stable, and recovers after exhaustion',()=>{
    vi.useFakeTimers();const events:((v:unknown)=>void)[]=[], failures:(()=>void)[]=[];
    const feed=createKotakFeed({session:{token:'t',sid:'s',baseUrl:'https://mis.kotaksecurities.com'},accountId:'A'},vi.fn(),(_op,_data,event,fail)=>{events.push(event);failures.push(fail);return{send:vi.fn(),stop:vi.fn()};});
    for(let i=0;i<12;i++){
      events.at(-1)!({type:'state',channel:'market',state:'streaming'});
      events.at(-1)!({type:'state',channel:'orders',state:'streaming'});
      vi.advanceTimersByTime(60_000);failures.at(-1)!();vi.advanceTimersByTime(1000);
      expect(events).toHaveLength(i+2);
    }
    // Exhaust the budget with flapping market-only connections.
    for(let i=1;i<10;i++){
      events.at(-1)!({type:'state',channel:'market',state:'streaming'});
      vi.advanceTimersByTime(60_000);failures.at(-1)!();vi.advanceTimersByTime(30_000);
    }
    const before=events.length;failures.at(-1)!();
    vi.advanceTimersByTime(299_999);expect(events).toHaveLength(before);
    vi.advanceTimersByTime(1);expect(events).toHaveLength(before+1);
    failures.at(-1)!();feed.stop();vi.advanceTimersByTime(600_000);
    expect(events).toHaveLength(before+1);expect(vi.getTimerCount()).toBe(0);
  });
  it('does not retry explicit credential failures',()=>{
    vi.useFakeTimers();let failure:Parameters<typeof startKotakSdk>[3]=()=>{};
    const launch=vi.fn<typeof startKotakSdk>((_op,_data,_event,fail)=>{failure=fail;return{send:vi.fn(),stop:vi.fn()};});
    const feed=createKotakFeed({session:{token:'t',sid:'s',baseUrl:'https://mis.kotaksecurities.com'},accountId:'A'},vi.fn(),launch);
    failure('TOTP_LOGIN');vi.advanceTimersByTime(86400000);expect(launch).toHaveBeenCalledOnce();feed.stop();
  });
  it('uses the SDK, deduplicates subscriptions and restarts a failed child with desired subscriptions',()=>{
    vi.useFakeTimers();const send=vi.fn(),stop=vi.fn(),receive=vi.fn();
    let event:(v:unknown)=>void=()=>{},failure=()=>{};
    const launch=vi.fn<typeof startKotakSdk>((_op,_data,onEvent,onError)=>{event=onEvent;failure=onError;return{send,stop};});
    const feed=createKotakFeed({session:{token:'t',sid:'s',baseUrl:'https://mis.kotaksecurities.com'},accountId:'A',appAccessToken:'key'},receive,launch);
    feed.subscribe(['nse_fo|123','nse_fo|123','bad']);feed.subscribe(['nse_fo|123']);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith({op:'subscribe',keys:['nse_fo|123']});
    event({type:'tick',key:'nse_fo|123',price:123,sourceAt:1800000000000});
    expect(receive).toHaveBeenLastCalledWith({type:'tick',key:'nse_fo|123',price:123,sourceAt:1800000000000});
    failure();vi.advanceTimersByTime(1000);expect(launch).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith({op:'subscribe',keys:['nse_fo|123']});
    feed.stop();vi.advanceTimersByTime(60000);expect(vi.getTimerCount()).toBe(0);
  });
  it('fails closed on invalid IPC without forwarding raw errors',()=>{
    vi.useFakeTimers();let event:(v:unknown)=>void=()=>{};const stop=vi.fn(),receive=vi.fn();
    const feed=createKotakFeed({session:{token:'t',sid:'s',baseUrl:'https://mis.kotaksecurities.com'},accountId:'A'},receive,(_op,_data,onEvent)=>{event=onEvent;return{send:vi.fn(),stop};});
    event({error:'sensitive raw detail'});
    expect(stop).toHaveBeenCalled();expect(JSON.stringify(receive.mock.calls)).not.toContain('sensitive');feed.stop();
  });
  it('restarts a terminal channel and ignores delayed events from the retired child',()=>{
    vi.useFakeTimers();const events:((v:unknown)=>void)[]=[],receive=vi.fn();
    const launch:typeof startKotakSdk=(_op,_data,onEvent)=>{events.push(onEvent);return{send:vi.fn(),stop:vi.fn()};};
    const feed=createKotakFeed({session:{token:'t',sid:'s',baseUrl:'https://mis.kotaksecurities.com'},accountId:'A'},receive,launch);
    events[0]!({type:'state',channel:'orders',state:'unavailable'});
    vi.advanceTimersByTime(1000);expect(events).toHaveLength(2);
    receive.mockClear();events[0]!({type:'order'});expect(receive).not.toHaveBeenCalled();
    events[1]!({type:'state',channel:'market',state:'streaming'});expect(receive).toHaveBeenCalledOnce();feed.stop();
  });
});
