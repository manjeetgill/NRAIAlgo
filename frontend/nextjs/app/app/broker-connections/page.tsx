import { BrokerConnectionsScreen } from "./broker-connections-screen";

/**
 * Broker Gateways (canonical route /app/broker-connections). Previews the
 * Zerodha Kite / Kotak Neo setup flow ahead of the broker adapter (build
 * order step 4) that will actually authenticate and store credentials.
 */
export default function BrokerConnectionsPage() {
  return <BrokerConnectionsScreen />;
}
