"use client";
import type { BrokerView } from "./broker-view";
import styles from "./market-open.module.css";
const options: [BrokerView, string][] = [["all","All Brokers"],["zerodha","Zerodha"],["kotak","Kotak"],["icici","ICICI"]];
export function BrokerFilter({value,onChange}:{value:BrokerView;onChange:(value:BrokerView)=>void}) {
  return <div className={styles.brokerFilters} role="group" aria-label="Dashboard view"><span>Dashboard view</span>{options.map(([key,label])=><button type="button" key={key} aria-pressed={value===key} onClick={()=>onChange(key)}>{label}</button>)}</div>;
}
