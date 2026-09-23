import { UpdatedAt } from "./updated-at";
import type { OverviewSnapshot } from "@nraialgo/contracts";
import type { BrokerView } from "./broker-view";
import styles from "./market-open.module.css";

export function BrokerDataStatus({ snapshot, broker, iciciStatus }: { snapshot: OverviewSnapshot; broker: BrokerView; iciciStatus: string }) {
  return <details className={styles.detail}><summary>Broker data sources &amp; refresh status</summary><dl className={styles.values}>
    {(broker === "all" || broker === "zerodha" || broker === "kotak") && <div><dt>{broker === "all" ? "Zerodha / Kotak" : broker === "zerodha" ? "Zerodha" : "Kotak"}</dt><dd>{snapshot.holdings.status} · <UpdatedAt value={snapshot.holdings.asOf}/><small>{snapshot.holdings.reason}</small></dd></div>}
    {(broker === "all" || broker === "icici") && <div><dt>ICICI</dt><dd>{iciciStatus}<small>Account reconciliation: 30 seconds · prices update from the server-owned Breeze WebSocket when streaming</small></dd></div>}
  </dl></details>;
}
