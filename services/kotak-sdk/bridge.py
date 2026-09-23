"""Private JSON-lines bridge. No HTTP listener and no order mutation methods.

Credentials arrive on stdin, never command-line arguments. stdout is reserved
for bounded protocol messages; third-party output is discarded, not logged.
"""
import asyncio
import concurrent.futures
import json
import logging
import math
import os
import re
import sys
from urllib.parse import urlparse

PROTOCOL = sys.stdout
sys.stdout = open(os.devnull, "w")
logging.disable(logging.CRITICAL)

try:
    from neo_api_client import NeoAPI
    from neo_api_client.websocket.feed import WsToken
    from neo_api_client.websocket.feed.exceptions import NotConnectedError as MarketDisconnected
    from neo_api_client.websocket.orderfeed.exceptions import NotConnectedError as OrdersDisconnected
except ImportError:
    NeoAPI = None

TOKEN = re.compile(r"^(nse_cm|nse_fo|cde_fo|nse_com|bse_cm|bse_fo|bse_cd|bse_co|mcx_fo|ncd_co)\|[1-9]\d*$")


def emit(value):
    PROTOCOL.write(json.dumps(value, allow_nan=False, separators=(",", ":")) + "\n")
    PROTOCOL.flush()


class BridgeFailure(ValueError):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def error_code(error):
    if isinstance(error, BridgeFailure):
        return error.code
    if isinstance(error, TimeoutError) or getattr(error, "status", None) in (408, 504) or str(getattr(error, "reason", "")).startswith("Request timeout after "):
        return "SDK_TIMEOUT"
    return "SDK_UPSTREAM"


def checked(value, stage=None):
    if isinstance(value, dict) and any(k in value for k in ("error", "Error", "Error Message", "errors")):
        errors = value.get("error", value.get("errors", []))
        codes = {str(e.get("code")) for e in errors if isinstance(e, dict)} if isinstance(errors, list) else set()
        if codes & {"408", "504"}:
            raise BridgeFailure("SDK_TIMEOUT")
        if codes & {"429", "500", "502", "503"}:
            raise BridgeFailure("SDK_UPSTREAM")
        if stage and isinstance(errors, list) and errors:
            raise BridgeFailure(stage)
        raise BridgeFailure("SDK_UPSTREAM")
    return value


def rows(value):
    value = checked(value).get("data")
    if isinstance(value, dict):
        value = value.get("data")
    if not isinstance(value, list):
        raise ValueError("INVALID_POSITIONS")
    return value


def restore(data):
    session = data["session"]
    base = urlparse(session["baseUrl"])
    host = base.hostname or ""
    if base.scheme != "https" or not (host == "kotaksecurities.com" or host.endswith(".kotaksecurities.com")) or base.username or base.password or base.port not in (None, 443):
        raise ValueError("INVALID_BROKER_HOST")
    client = NeoAPI(consumer_key=data["appAccessToken"], timeout=8)
    client.configuration.edit_token = session["token"]
    client.configuration.edit_sid = session["sid"]
    client.configuration.base_url = session["baseUrl"]
    client.configuration.ucc = data["accountId"]
    return client


def portfolio(client):
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        reads = [pool.submit(fn) for fn in (client.holdings, client.positions, client.limits)]
        holdings, positions, limits = [checked(f.result()) for f in reads]
    tokens = []
    for row in rows(positions):
        if "cfBuyQty" not in row:
            continue
        quantity = float(row["cfBuyQty"]) + float(row["flBuyQty"]) - float(row["cfSellQty"]) - float(row["flSellQty"])
        if quantity:
            key = f'{row["exSeg"]}|{row["tok"]}'
            if not TOKEN.fullmatch(key):
                raise ValueError("INVALID_POSITION_TOKEN")
            tokens.append({"exchange_segment": row["exSeg"], "instrument_token": str(row["tok"])})
    quotes = []
    for start in range(0, len(tokens), 50):
        batch = checked(client.quotes(instrument_tokens=tokens[start:start + 50], quote_type="ltp"))
        if not isinstance(batch, list):
            raise ValueError("INVALID_QUOTES")
        quotes.extend(batch)
    return dict(holdings=holdings, positions=positions, limits=limits, quotes=quotes)


def login(data):
    client = NeoAPI(consumer_key=data["accessToken"], timeout=8)
    # Preserve HTTP errors as typed SDK exceptions instead of discarding their
    # status in an arbitrary response body. No exception text crosses IPC.
    client.api_client.rest_client.raise_on_error = True
    def step(stage, call):
        try:
            value = checked(call(), stage)
        except Exception as error:
            if getattr(error, "status", None) in (400, 401, 403):
                raise BridgeFailure(stage) from None
            raise
        if not isinstance(value, dict) or not isinstance(value.get("data"), dict):
            raise BridgeFailure("SDK_INVALID_RESPONSE")
        if value["data"].get("status") != "success":
            raise BridgeFailure(stage)
        return value
    first = step("TOTP_LOGIN", lambda: client.totp_login(mobile_number=data["mobileNumber"], ucc=data["ucc"], totp=data["totp"]))
    if first["data"].get("kType") != "View" or not first["data"].get("token") or not first["data"].get("sid"):
        raise BridgeFailure("SDK_INVALID_RESPONSE")
    second = step("MPIN_VERIFY", lambda: client.totp_validate(mpin=data["mpin"]))
    session = second.get("data", {})
    if session.get("kType") != "Trade" or any(not session.get(key) for key in ("token", "sid", "baseUrl")):
        raise BridgeFailure("SDK_INVALID_RESPONSE")
    return {key: session[key] for key in ("token", "sid", "baseUrl")}


def tick_message(message):
    if getattr(message, "type", None) != "scrip" or not hasattr(message, "last_update_time"):
        return None
    key = f"{message.exchange_segment}|{message.instrument_token}"
    price = float(message.last_traded_price)
    # kotakneoapi 3.x exposes the exchange's prior close as ``close_price``
    # on both SFeedScrip and SFeedScripLite. Keep the older alias as a
    # compatibility fallback for previously released SDK payloads.
    raw_close = getattr(message, "close_price", getattr(message, "closing_price", None))
    previous_close = float(raw_close) if raw_close is not None else None
    timestamp = int(message.last_update_time) * 1000
    if not TOKEN.fullmatch(key) or not math.isfinite(price) or price <= 0 or timestamp <= 0:
        return None
    return dict(type="tick", key=key, price=price, previousClose=previous_close if previous_close is not None and math.isfinite(previous_close) and previous_close > 0 else None, sourceAt=timestamp)


async def consume_feed(feed, deliver, stopping, reconnect_timeout=120):
    """Keep the SDK receive/reconnect task alive across iterator exhaustion.

    Both SDK iterators end during a disconnect, before the SDK retry starts.
    Only close on shutdown, a terminal error, or a bounded reconnect timeout.
    """
    try:
        await asyncio.wait_for(feed.connect(), timeout=30)
        disconnected_at = None
        while not stopping.is_set():
            if not feed.is_connected:
                now = asyncio.get_running_loop().time()
                if disconnected_at is None:
                    disconnected_at = now
                if now - disconnected_at >= reconnect_timeout:
                    raise TimeoutError("STREAM_RECOVERY_TIMEOUT")
                await asyncio.sleep(0.1)
                continue
            disconnected_at = None
            try:
                message = await anext(feed)
            except (StopAsyncIteration, MarketDisconnected, OrdersDisconnected):
                continue
            deliver(message)
    finally:
        await feed.close()


async def stream(client, data):
    # SDK owns auth, decoding, ping/pong, reconnect and resubscription.
    market = client.create_websocket(user=data["accountId"], auth=data["session"]["sid"], session_validation=True, max_reconnect_attempts=10)
    orders = client.create_order_feed(max_reconnect_attempts=10)
    wanted = set()
    changed = asyncio.Event()
    stopping = asyncio.Event()

    def state(channel, value):
        emit(dict(type="state", channel=channel, state=value))

    async def consume(channel, feed):
        feed.on_connect = lambda: (state(channel, "streaming"), emit(dict(type="order")), changed.set())
        feed.on_disconnect = lambda: state(channel, "reconnecting")
        state(channel, "connecting")
        def deliver(message):
            if channel == "market":
                tick = tick_message(message)
                if tick and tick["key"] in wanted:
                    emit(tick)
            elif getattr(message, "type", None) in ("order", "position"):
                emit(dict(type="order"))
        try:
            await consume_feed(feed, deliver, stopping)
        except Exception:
            pass
        finally:
            state(channel, "unavailable")
            # Exit the bridge so Node's bounded restart restores BOTH feeds
            # and the latest desired subscriptions; never leave an idle child.
            stopping.set()

    async def subscriptions():
        subscribed = set()
        while True:
            await changed.wait()
            changed.clear()
            if not market.is_connected:
                continue
            try:
                target = set(wanted)
                removed, added = subscribed - target, target - subscribed
                if removed:
                    await market.unsubscribe_scrips([WsToken(*key.split("|")) for key in sorted(removed)])
                if added:
                    await market.subscribe_scrips([WsToken(*key.split("|")) for key in sorted(added)])
                subscribed = target
            except Exception:
                state("market", "unavailable")
                stopping.set()
                return

    async def commands():
        nonlocal wanted
        reader = asyncio.StreamReader(limit=1_000_000)
        protocol = asyncio.StreamReaderProtocol(reader)
        await asyncio.get_running_loop().connect_read_pipe(lambda: protocol, sys.stdin)
        try:
            while line := await reader.readline():
                command = json.loads(line)
                if command.get("op") != "subscribe":
                    raise ValueError("INVALID_COMMAND")
                keys = command["keys"]
                if len(keys) > 3000 or any(not isinstance(k, str) or not TOKEN.fullmatch(k) for k in keys):
                    raise ValueError("INVALID_SUBSCRIPTIONS")
                wanted = set(keys)
                changed.set()
        finally:
            stopping.set()

    tasks = [asyncio.create_task(consume("market", market)), asyncio.create_task(consume("orders", orders)), asyncio.create_task(subscriptions()), asyncio.create_task(commands())]
    try:
        await stopping.wait()
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await market.close()
        await orders.close()


def main():
    try:
        if NeoAPI is None:
            raise BridgeFailure("SDK_MISSING")
        # Unbuffered initial read avoids swallowing subsequent subscription lines.
        raw = bytearray()
        while len(raw) <= 1_000_000:
            byte = os.read(0, 1)
            if byte in (b"\n", b""):
                break
            raw.extend(byte)
        request = json.loads(raw)
        op, data = request["op"], request["data"]
        if op == "login":
            emit(dict(result=login(data)))
        elif op == "portfolio":
            emit(dict(result=portfolio(restore(data))))
        elif op == "stream":
            asyncio.run(stream(restore(data), data))
        else:
            raise ValueError("OPERATION_NOT_ALLOWED")
    except Exception as error:
        # No broker response, exception, token or traceback crosses the bridge.
        emit(dict(error=error_code(error)))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
