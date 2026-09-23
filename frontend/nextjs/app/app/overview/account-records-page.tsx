"use client";
import { useState, useMemo } from "react";
import Link from "next/link";
import { useOverviewSnapshot } from "./use-overview-snapshot";
import { useIciciAccount } from "./use-icici-account";
import { iciciPositions } from "./icici-model";
import { withIciciOverviewStatus } from "./icici-overview-status";
import { useShellOverview } from "@/app/components/shell/overview-context";
import { BROKER_LABELS, hasCoreCoverage, selectedProviders } from "./broker-view";
import { FilterDrawer } from "./filter-drawer";
import { BrokerHealth } from "./broker-health";
import { OpenPositions } from "./open-positions";
import { RecordTable } from "./record-table";
import { formatPaise } from "./format";
import styles from "./market-open.module.css";
import pageStyles from "./overview.module.css";

export function formatBrokerMoney(value: unknown) {
  const normalized = typeof value === "string" ? value.replaceAll(",", "").trim() : value;
  const amount = normalized === "" || (typeof normalized !== "string" && typeof normalized !== "number") ? Number.NaN : Number(normalized);
  return Number.isFinite(amount) ? formatPaise(Math.round(amount * 100)) : "Not supplied";
}

export function AccountRecordsPage({ kind }: { kind: "positions" | "orders" | "funds" }) {
  const overview = useOverviewSnapshot(), icici = useIciciAccount();
  const snapshot = useMemo(() => overview.snapshot ? withIciciOverviewStatus(overview.snapshot,icici.account,icici.stale,icici.live) : null,[overview.snapshot,icici.account,icici.stale,icici.live]);
  useShellOverview(snapshot,overview.stale);
  const [broker,setBroker] = useState("all"), [search,setSearch] = useState(""), [exchange,setExchange] = useState("all"), [product,setProduct] = useState("all");
  const waitingForIcici = !!snapshot?.configuredProviders?.includes("icici") && (broker === "all" || broker === "icici") && icici.loading && !icici.account;
  if (!snapshot || waitingForIcici) return <section className={pageStyles.page}><h1>{kind==="positions"?"Open Positions":kind==="orders"?"Orders":"Funds & Margin"}</h1><BrokerHealth snapshot={snapshot}/><p role="status">{overview.error ?? (waitingForIcici ? "Loading ICICI account snapshot…" : "Loading latest broker snapshot…")}</p><p><Link href="/app/overview">Back to overview</Link></p></section>;
  const include = selectedProviders(snapshot,broker).includes("icici");
  const positions = [...(snapshot?.positions?.data ?? []).filter(row=>row.quantity!==0).map(row=>({ id:`${row.provider}:${row.accountId}:${row.exchange}:${row.symbol}:${row.product}`, provider:row.provider, account:row.accountId, symbol:row.symbol, exchange:row.exchange, product:row.product, quantity:row.quantity, average:row.averagePrice, ltp:row.lastPrice, previousClose:row.previousClose ?? null, pnlPaise:row.pnlPaise, mtmPaise:row.mtmPaise ?? null, side:row.quantity<0 ? "SELL" as const:"BUY" as const, asOf:row.asOf, details:{...row,...row.details} })), ...(include && icici.account ? iciciPositions(icici.account.sections.portfoliopositions?.rows ?? [],icici.account.accountId,icici.account.sections.portfoliopositions?.asOf ?? icici.account.asOf):[])];
  const orders = [...(snapshot?.brokerOrders?.data ?? []).map(row=>({ ...row, provider:"zerodha", details:{...row}})), ...(include ? icici.account?.sections.order?.rows ?? []:[]).map((row,index)=>({provider:"icici",orderId:String(row.order_id??index),symbol:String(row.stock_code??"Not supplied"), exchange:String(row.exchange_code??"Not supplied"),product:String(row.product_type??"Not supplied"),side:row.action,status:row.status,quantity:row.quantity,details:{...row}}))];
  const matches = (row: {provider:string;symbol:string;exchange:string;product:string}) => (broker==="all" || row.provider===broker) && (exchange==="all"||row.exchange===exchange) && (product==="all"||row.product===product) && row.symbol.toLowerCase().includes(search.toLowerCase());
  const records = kind==="positions" ? positions:orders;
  const funds = [...(snapshot.holdings.data?.brokerBalances ?? []).filter(row=>broker==="all"||row.provider===broker).flatMap(row=>[ ["Available margin",row.availableMarginPaise],["Used margin",row.usedMarginPaise],["Collateral",row.collateralPaise] ].map(([label,value])=>({provider:row.provider,account:row.accountId,label:String(label),value:typeof value === "number" && Number.isFinite(value) ? formatPaise(value) : "Not supplied",asOf:row.asOf}))), ...(include ? icici.account?.sections.funds?.rows ?? []:[]).flatMap(row=>Object.entries(row).filter(([,value])=>value!=null).map(([label,value])=>({provider:"icici",account:icici.account!.accountId,label:label.replaceAll("_"," "),value:formatBrokerMoney(value),asOf:icici.account!.asOf})))];
  return <section className={pageStyles.page}><h1>{kind==="positions"?"Open Positions":kind==="orders"?"Orders":"Funds & Margin"}</h1><BrokerHealth snapshot={snapshot} stale={overview.stale}/><p>Latest broker snapshot · Read-only · <Link href="/app/overview">Back to overview</Link></p>
    <FilterDrawer><div className={styles.positionToolbar}><label>Broker <select value={broker} onChange={e=>{setBroker(e.target.value);setExchange("all");setProduct("all");}}>{Object.entries(BROKER_LABELS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>{kind!=="funds" && <><label>Search <input type="search" value={search} onChange={e=>setSearch(e.target.value)}/></label><label>Exchange <select value={exchange} onChange={e=>setExchange(e.target.value)}><option value="all">All exchanges</option>{[...new Set(records.map(row=>row.exchange))].map(value=><option key={value}>{value}</option>)}</select></label><label>Product <select value={product} onChange={e=>setProduct(e.target.value)}><option value="all">All products</option>{[...new Set(records.map(row=>row.product))].map(value=><option key={value}>{value}</option>)}</select></label></>}<button className={styles.button} onClick={()=>{overview.refresh();if(include)icici.refresh();}}>Refresh</button></div></FilterDrawer>
    {overview.error && <p role="status">{overview.error}</p>}
    {kind==="positions" && <OpenPositions showBroker={broker === "all"} key={`${broker}:${exchange}:${product}:${search}`} detailed rows={positions.filter(matches)} scope={`${BROKER_LABELS[broker as keyof typeof BROKER_LABELS]} · ${exchange} · ${product} · ${search}`} marginPaise={!include && snapshot?.holdings.status === "available" && hasCoreCoverage(snapshot,broker,"holdings") ? snapshot.holdings.data.brokerBalances?.filter(row=>broker==="all"||row.provider===broker).reduce((sum,row)=>sum+row.usedMarginPaise,0) ?? null : null} available={!overview.stale && hasCoreCoverage(snapshot,broker,"positions") && (!include||!icici.stale&&icici.account?.sections.portfoliopositions?.status==="available")} />}
    {kind==="orders" && <><p>Same-day reported orders. Not an audit ledger. <sup title="Kotak order reads are not connected; ICICI exchange failures are described below.">*</sup></p><RecordTable rows={orders.filter(matches)} label="Broker orders" id={(row,i)=>row.provider+row.orderId+i} details={row=>({...row.details,...("details" in row.details && typeof row.details.details === "object" ? row.details.details : {})})} columns={["symbol","provider","exchange","product","side","quantity","status"].map(key=>({key,label:({symbol:"Instrument",provider:"Broker",exchange:"Exchange",product:"Product",side:"Side",quantity:"Quantity",status:"Status",account:"Account",label:"Balance type",value:"Amount"} as Record<string,string>)[key] ?? key,value:(row: typeof orders[number])=>row[key as keyof typeof row] as string|number|null}))}/><details><summary>Order coverage</summary><p>Zerodha: {snapshot?.brokerOrders?.status ?? "Not received"} · {snapshot?.brokerOrders?.reason}</p><p>Kotak: order service not connected.</p>{include && <p>ICICI: {icici.account?.sections.order?.status ?? "Not received"} · {icici.account?.sections.order?.reason}</p>}</details></>}
    {kind==="funds" && <><p>Balances stay separate by broker and type. Bank balance is not available trading margin. ICICI values use broker-reported units.</p><RecordTable rows={funds} label="Broker funds" id={(row,i)=>row.provider+row.label+i} details={row=>({...row})} columns={["provider","account","label","value"].map(key=>({key,label:({symbol:"Instrument",provider:"Broker",exchange:"Exchange",product:"Product",side:"Side",quantity:"Quantity",status:"Status",account:"Account",label:"Balance type",value:"Amount"} as Record<string,string>)[key] ?? key,value:(row: typeof funds[number])=>row[key as keyof typeof row]}))}/></>}
  </section>;
}
