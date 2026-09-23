import asyncio
import math
import json
import subprocess
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "services/kotak-sdk"))
import bridge


class BridgeTests(unittest.TestCase):
    def test_restore_rejects_untrusted_hosts_before_constructing_client(self):
        for url in ("http://mis.kotaksecurities.com", "https://kotaksecurities.com.attacker.test", "https://user@mis.kotaksecurities.com", "https://mis.kotaksecurities.com:8888"):
            with self.subTest(url=url), patch.object(bridge, "NeoAPI") as sdk:
                with self.assertRaises(ValueError):
                    bridge.restore({"session": {"baseUrl": url}})
                sdk.assert_not_called()

    def test_restore_reuses_saved_session_without_logging_in(self):
        data = {"session": {"baseUrl": "https://mis.kotaksecurities.com", "token": "secret", "sid": "sid"}, "appAccessToken": "app", "accountId": "account"}
        with patch.object(bridge, "NeoAPI") as sdk:
            client = bridge.restore(data)
            self.assertEqual(client.configuration.edit_token, "secret")
            self.assertEqual(client.configuration.ucc, "account")
            client.totp_login.assert_not_called()

    def test_login_uses_official_two_step_methods(self):
        client = Mock()
        client.totp_login.return_value = {"data": {"status": "success", "kType": "View", "token": "t", "sid": "s"}}
        client.totp_validate.return_value = {"data": {"status": "success", "kType": "Trade", "token": "t", "sid": "s", "baseUrl": "https://mis.kotaksecurities.com"}}
        with patch.object(bridge, "NeoAPI", return_value=client):
            result = bridge.login(dict(accessToken="app", mobileNumber="mobile", ucc="account", totp="otp", mpin="pin"))
        client.totp_login.assert_called_once_with(mobile_number="mobile", ucc="account", totp="otp")
        client.totp_validate.assert_called_once_with(mpin="pin")
        self.assertEqual(result["token"], "t")

    def test_failed_login_does_not_attempt_mpin(self):
        client = Mock(); client.totp_login.return_value = {"error": [{"code": "400", "message": "secret failure"}]}
        with patch.object(bridge, "NeoAPI", return_value=client), self.assertRaisesRegex(ValueError, "TOTP_LOGIN"):
            bridge.login(dict(accessToken="app", mobileNumber="mobile", ucc="account", totp="otp", mpin="pin"))
        client.totp_validate.assert_not_called()

    def test_mpin_rejection_and_upstream_errors_are_distinct(self):
        client = Mock()
        client.totp_login.return_value = {"data": {"status": "success", "kType": "View", "token": "t", "sid": "s"}}
        data = dict(accessToken="app", mobileNumber="mobile", ucc="account", totp="otp", mpin="pin")
        for code, expected in (("400", "MPIN_VERIFY"), ("503", "SDK_UPSTREAM"), ("504", "SDK_TIMEOUT")):
            client.totp_validate.return_value = {"error": [{"code": code, "message": "secret detail"}]}
            with patch.object(bridge, "NeoAPI", return_value=client), self.assertRaisesRegex(bridge.BridgeFailure, expected):
                bridge.login(data)

    def test_sdk_transport_timeout_is_sanitized(self):
        from neo_api_client.exceptions import ApiException
        self.assertEqual(bridge.error_code(ApiException(status=0, reason="Request timeout after 8 seconds")), "SDK_TIMEOUT")
        self.assertEqual(bridge.error_code(ApiException(status=0, reason="secret connection detail")), "SDK_UPSTREAM")
        self.assertEqual(bridge.error_code(ValueError("secret")), "SDK_UPSTREAM")

    def test_missing_sdk_emits_only_allowlisted_error(self):
        result = subprocess.run([sys.executable, "-S", bridge.__file__], input=json.dumps({"op": "login", "data": {"token": "secret"}}), text=True, capture_output=True, timeout=5)
        self.assertEqual(json.loads(result.stdout), {"error": "SDK_MISSING"})
        self.assertEqual(result.returncode, 1)
        self.assertNotIn("secret", result.stdout + result.stderr)

    def test_portfolio_reads_and_quote_batches(self):
        client = Mock()
        client.holdings.return_value = {"data": []}
        client.positions.return_value = {"data": [dict(cfBuyQty="65", flBuyQty="0", cfSellQty="0", flSellQty="0", exSeg="nse_fo", tok=str(i + 1)) for i in range(51)]}
        client.limits.return_value = {"Net": "100"}
        client.quotes.return_value = []
        result = bridge.portfolio(client)
        self.assertEqual(len(result["positions"]["data"]), 51)
        self.assertEqual(client.quotes.call_count, 2)
        self.assertEqual(client.quotes.call_args_list[0].kwargs["quote_type"], "ltp")
        self.assertEqual(len(client.quotes.call_args_list[0].kwargs["instrument_tokens"]), 50)
        client.place_order.assert_not_called()

    def test_tick_uses_sdk_decoded_price_and_source_update_timestamp(self):
        tick = SimpleNamespace(type="scrip", exchange_segment="nse_fo", instrument_token="123", last_traded_price=123.45, close_price=120.0, last_update_time=1800000000)
        self.assertEqual(bridge.tick_message(tick), dict(type="tick", key="nse_fo|123", price=123.45, previousClose=120.0, sourceAt=1800000000000))
        tick.last_traded_price = math.nan
        self.assertIsNone(bridge.tick_message(tick))
        self.assertIsNone(bridge.tick_message(SimpleNamespace(type="index")))


class LifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def test_real_sdk_iterators_survive_disconnect_before_reconnect(self):
        from neo_api_client.websocket.feed import SFeedWebSocket
        from neo_api_client.websocket.orderfeed import OrderFeedWebSocket
        for cls in (SFeedWebSocket, OrderFeedWebSocket):
            with self.subTest(channel=cls.__name__):
                feed = cls(access_token="test", sid="test") if cls is SFeedWebSocket else cls(base_url="https://mis.kotaksecurities.com", auth="test", sid="test")
                feed._connected = True
                feed._ws = SimpleNamespace(closed=False)
                feed.connect = AsyncMock()
                feed.close = AsyncMock()
                stopping = asyncio.Event()
                received = []
                def deliver(message):
                    received.append(message)
                    stopping.set()
                task = asyncio.create_task(bridge.consume_feed(feed, deliver, stopping))
                await asyncio.sleep(0.05)
                feed._connected = False
                # Actual SDK __anext__ terminates at its one-second timeout.
                await asyncio.sleep(1.1)
                feed.close.assert_not_called()
                self.assertFalse(task.done())
                feed._connected = True
                feed._message_queue.put_nowait("after-reconnect")
                await asyncio.wait_for(task, 1)
                self.assertEqual(received, ["after-reconnect"])
                feed.close.assert_awaited_once()

    async def test_exhausted_reconnect_closes_instead_of_waiting_forever(self):
        feed = SimpleNamespace(connect=AsyncMock(), close=AsyncMock(), is_connected=False)
        with self.assertRaises(TimeoutError):
            await bridge.consume_feed(feed, Mock(), asyncio.Event(), reconnect_timeout=0.01)
        feed.close.assert_awaited_once()

    async def test_shutdown_cancels_idle_consumer(self):
        feed = SimpleNamespace(connect=AsyncMock(), close=AsyncMock(), is_connected=False)
        task = asyncio.create_task(bridge.consume_feed(feed, Mock(), asyncio.Event()))
        await asyncio.sleep(0.01)
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        feed.close.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
