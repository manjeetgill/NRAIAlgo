import type { EodIntelligenceData } from "@nraialgo/contracts";

const SECTORS = [
  { indexName: "Nifty Bank", instrumentId: "NSE:BANKNIFTY", label: "Banking & Finance" },
  { indexName: "Nifty IT", instrumentId: "NSE:NIFTYIT", label: "Technology & IT" },
  { indexName: "Nifty Auto", instrumentId: "NSE:NIFTYAUTO", label: "Auto & EV" },
  { indexName: "Nifty FMCG", instrumentId: "NSE:NIFTYFMCG", label: "Consumer Goods" },
] as const;

const cache = new Map<string, EodIntelligenceData>();

function stamp(day: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) throw new Error("Invalid NSE EOD report date");
  return `${match[3]}${match[2]}${match[1]}`;
}

function priorTradingDays(day: string, count = 5): string[] {
  const current = new Date(`${day}T00:00:00Z`);
  const days: string[] = [];
  while (days.length < count) {
    const candidate = current.toISOString().slice(0, 10);
    if (current.getUTCDay() !== 0 && current.getUTCDay() !== 6) days.push(candidate);
    current.setUTCDate(current.getUTCDate() - 1);
  }
  return days;
}

function nseDateToIso(value: unknown): string | null {
  const match = /^(\d{2})-([A-Za-z]{3})-(\d{4})$/.exec(String(value ?? ""));
  const month = match ? ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].indexOf(match[2]!) + 1 : 0;
  return match && month ? `${match[3]}-${String(month).padStart(2, "0")}-${match[1]}` : null;
}

function csvRows(csv: string): string[][] {
  return csv.trim().split(/\r?\n/).map(line => line.split(",").map(cell => cell.trim().replace(/^"+|"+$/g, "")));
}

function numeric(value: string | undefined, field: string): number {
  const parsed = Number(value);
  if (value == null || value === "" || !Number.isFinite(parsed)) throw new Error(`Invalid NSE ${field}`);
  return parsed;
}

export function parseParticipantOiCsv(csv: string): NonNullable<EodIntelligenceData["participantOi"]> {
  const rows = csvRows(csv);
  const headerIndex = rows.findIndex(row => row[0] === "Client Type");
  if (headerIndex < 0) throw new Error("Unexpected NSE participant OI CSV format");
  const header = rows[headerIndex]!;
  const column = (name: string) => {
    const index = header.indexOf(name);
    if (index < 0) throw new Error(`NSE participant OI column missing: ${name}`);
    return index;
  };
  const columns = {
    futureIndexLong: column("Future Index Long"), futureIndexShort: column("Future Index Short"),
    optionIndexCallLong: column("Option Index Call Long"), optionIndexPutLong: column("Option Index Put Long"),
    optionIndexCallShort: column("Option Index Call Short"), optionIndexPutShort: column("Option Index Put Short"),
  };
  const categories = ["Client", "DII", "FII", "Pro"] as const;
  return categories.map(category => {
    const row = rows.slice(headerIndex + 1).find(candidate => candidate[0] === category);
    if (!row) throw new Error(`NSE participant OI row missing: ${category}`);
    return {
      category,
      futureIndexLong: numeric(row[columns.futureIndexLong], `${category} future index long`),
      futureIndexShort: numeric(row[columns.futureIndexShort], `${category} future index short`),
      optionIndexCallLong: numeric(row[columns.optionIndexCallLong], `${category} option call long`),
      optionIndexPutLong: numeric(row[columns.optionIndexPutLong], `${category} option put long`),
      optionIndexCallShort: numeric(row[columns.optionIndexCallShort], `${category} option call short`),
      optionIndexPutShort: numeric(row[columns.optionIndexPutShort], `${category} option put short`),
    };
  });
}

export function parseFiiDiiJson(value: unknown, day: string): NonNullable<EodIntelligenceData["cashActivity"]> {
  if (!Array.isArray(value)) throw new Error("Unexpected NSE FII/DII response format");
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) throw new Error("Invalid NSE FII/DII report date");
  const month = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][Number(match[2]) - 1];
  const expectedDate = `${match[3]}-${month}-${match[1]}`;
  const categories = ["FII/FPI", "DII"] as const;
  return categories.map(category => {
    const row = value.find(item => item && typeof item === "object" && (item as Record<string, unknown>).category === category) as Record<string, unknown> | undefined;
    if (!row || row.date !== expectedDate) throw new Error(`NSE ${category} cash activity is not available for ${day}`);
    const buyCrore = numeric(String(row.buyValue ?? ""), `${category} buy value`);
    const sellCrore = numeric(String(row.sellValue ?? ""), `${category} sell value`);
    const netCrore = numeric(String(row.netValue ?? ""), `${category} net value`);
    if (Math.abs((buyCrore - sellCrore) - netCrore) > 0.02) throw new Error(`NSE ${category} cash activity does not reconcile`);
    return { category, buyCrore, sellCrore, netCrore };
  });
}

export function parseSectorPerformanceCsv(csv: string): NonNullable<EodIntelligenceData["sectorPerformance"]> {
  const rows = csvRows(csv);
  const header = rows[0] ?? [];
  const name = header.indexOf("Index Name");
  const close = header.indexOf("Closing Index Value");
  const change = header.indexOf("Points Change");
  const changePct = header.indexOf("Change(%)");
  if ([name, close, change, changePct].some(index => index < 0)) throw new Error("Unexpected NSE index-close CSV format");
  return SECTORS.map(sector => {
    const row = rows.slice(1).find(candidate => candidate[name] === sector.indexName);
    if (!row) throw new Error(`NSE sector row missing: ${sector.indexName}`);
    return { instrumentId: sector.instrumentId, label: sector.label, close: numeric(row[close], `${sector.indexName} close`), change: numeric(row[change], `${sector.indexName} change`), changePct: numeric(row[changePct], `${sector.indexName} change percent`) };
  });
}

async function text(url: string): Promise<string> {
  const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", Accept: "text/csv" }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`NSE report request failed (HTTP ${response.status})`);
  return response.text();
}

async function latestParticipantOi(day: string) {
  for (const candidate of priorTradingDays(day)) {
    try {
      const rows = parseParticipantOiCsv(await text(`https://nsearchives.nseindia.com/content/nsccl/fao_participant_oi_${stamp(candidate)}.csv`));
      return { rows, date: candidate };
    } catch { /* NSE publishes this report with a delay; try the prior session. */ }
  }
  throw new Error("NSE participant OI report unavailable");
}

async function latestCashActivity(day: string) {
  const response = await fetch("https://www.nseindia.com/api/fiidiiTradeReact", { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json", Referer: "https://www.nseindia.com/reports/fii-dii" }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`NSE FII/DII request failed (HTTP ${response.status})`);
  const value = await response.json();
  const first = Array.isArray(value) ? value[0] as Record<string, unknown> | undefined : undefined;
  const reportDate = nseDateToIso(first?.date);
  if (!reportDate || reportDate > day || !priorTradingDays(day).includes(reportDate)) throw new Error("NSE FII/DII report is outside the accepted EOD window");
  return { rows: parseFiiDiiJson(value, reportDate), date: reportDate };
}

export async function fetchNseEodIntelligence(day: string): Promise<{ data: EodIntelligenceData; missing: string[] }> {
  const cached = cache.get(day);
  if (cached) return { data: cached, missing: [] };
  const dateStamp = stamp(day);
  const [participant, cash, sectors] = await Promise.allSettled([
    latestParticipantOi(day),
    latestCashActivity(day),
    text(`https://nsearchives.nseindia.com/content/indices/ind_close_all_${dateStamp}.csv`).then(parseSectorPerformanceCsv),
  ]);
  const data: EodIntelligenceData = {
    reportDate: day,
    ...(cash.status === "fulfilled" ? { cashActivityDate: cash.value.date } : {}),
    ...(participant.status === "fulfilled" ? { participantOiDate: participant.value.date } : {}),
    ...(sectors.status === "fulfilled" ? { sectorPerformanceDate: day } : {}),
    cashActivity: cash.status === "fulfilled" ? cash.value.rows : null,
    participantOi: participant.status === "fulfilled" ? participant.value.rows : null,
    sectorPerformance: sectors.status === "fulfilled" ? sectors.value : null,
  };
  const missing = [participant.status === "rejected" ? "participant OI" : null, cash.status === "rejected" ? "FII/DII cash activity" : null, sectors.status === "rejected" ? "sector index performance" : null].filter((item): item is string => item !== null);
  if (missing.length === 3) throw new Error("All NSE EOD intelligence reports were unavailable");
  if (!missing.length) cache.set(day, data);
  return { data, missing };
}
