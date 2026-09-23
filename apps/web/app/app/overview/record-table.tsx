"use client";
import { useState, type ReactNode } from "react";
import { formatPaise, formatTimestamp } from "./format";
import styles from "./market-open.module.css";

export type FieldValue = string | number | boolean | null | undefined;
export function RecordDetails({ fields }: { fields: Record<string, unknown> }) {
  const [open,setOpen] = useState(false);
  return <details onToggle={event=>setOpen(event.currentTarget.open)}><summary>View all broker fields</summary>{open && <dl className={styles.recordFields}>{Object.entries(fields).filter(([, value]) => value == null || ["string", "number", "boolean"].includes(typeof value)).map(([key, value]) => <div key={key}><dt>{key.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ")}</dt><dd>{value == null ? "Not supplied" : key.endsWith("Paise") && typeof value === "number" ? formatPaise(value) : typeof value === "string" && /^\d{4}-\d\d-\d\dT/.test(value) ? `${formatTimestamp(value)} IST` : String(value)}</dd></div>)}</dl>}</details>;
}
export interface RecordColumn<T> { key: string; label: string; value: (row: T) => FieldValue; render?: (row: T) => ReactNode; optional?: boolean }
export function RecordTable<T>({ rows, columns, label, id, group, details, limit }: { rows: T[]; columns: RecordColumn<T>[]; label: string; id: (row: T, index: number) => string; group?: (row: T) => string; details?: ((row: T) => Record<string, unknown>) | undefined; limit?: number | undefined }) {
  const [hidden, setHidden] = useState<string[]>(columns.filter(c => c.optional).map(c => c.key));
  const [sort, setSort] = useState({ key: columns[0]!.key, descending: false });
  const [page, setPage] = useState(0);
  const active = columns.filter(column => !hidden.includes(column.key));
  const sorted = [...rows].sort((a,b) => {
    const grouping = group ? group(a).localeCompare(group(b)) : 0;
    if (grouping) return grouping;
    const column = columns.find(c => c.key === sort.key)!;
    const left = column.value(a), right = column.value(b);
    if (left == null) return right == null ? 0 : 1;
    if (right == null) return -1;
    const result = typeof left === "number" && typeof right === "number" ? left-right : String(left).localeCompare(String(right), "en", {numeric:true});
    return sort.descending ? -result : result;
  });
  const size = limit ?? 25, pages = Math.max(1, Math.ceil(rows.length / size)), current = Math.min(page, pages-1);
  const shown = sorted.slice(limit ? 0 : current*size, limit ? size : (current+1)*size);
  const groups = group ? [...new Set(shown.map(group))] : [""];
  return <div className={`${styles.positionTable} ${styles.detailedPortfolio}`}>
    {!limit && <details className={styles.columnPicker}><summary>Columns</summary>{columns.slice(1).map(column => <label key={column.key}><input type="checkbox" checked={!hidden.includes(column.key)} onChange={() => setHidden(old => old.includes(column.key) ? old.filter(key => key !== column.key) : [...old, column.key])} />{column.label}</label>)}</details>}
    <div className={styles.tableScroll} role="region" aria-label={label === "Portfolio holdings by broker" ? "Scrollable cash holdings" : `Scrollable ${label}`} tabIndex={0}><table aria-label={label}><thead><tr>{active.map(column => <th key={column.key} scope="col" aria-sort={sort.key === column.key ? sort.descending ? "descending" : "ascending" : "none"}><button className={styles.sortHeader} onClick={() => {setPage(0); setSort(old => ({key:column.key,descending:old.key === column.key ? !old.descending:false}));}}>{column.label}<span aria-hidden="true"> {sort.key === column.key ? sort.descending ? "▼" : "▲" : "↕"}</span></button></th>)}</tr></thead>{groups.map(name => <tbody key={name} aria-label={name ? `${name} holdings` : undefined}>{name && <tr className={styles.portfolioGroup}><th colSpan={active.length} scope="rowgroup">{name} · {rows.filter(row => group!(row) === name).length} holdings</th></tr>}{shown.filter(row => !group || group(row) === name).map((row,index) => <tr key={id(row,index)}>{active.map((column,i) => <td key={column.key} data-label={column.label}>{column.render ? column.render(row) : String(column.value(row) ?? "Not supplied")}{i === 0 && details && <RecordDetails fields={details(row)} />}</td>)}</tr>)}</tbody>)}{!rows.length && <tbody><tr><td colSpan={active.length}>No records received for this selection.</td></tr></tbody>}</table></div>
    {!limit && <nav aria-label={`${label} pages`}><button type="button" disabled={current===0} onClick={() => setPage(current-1)}>Previous</button><span>Page {current+1} of {pages} · 25 per page</span><button type="button" disabled={current+1>=pages} onClick={() => setPage(current+1)}>Next</button></nav>}
  </div>;
}
