import type {
  CalculationReconciliationData,
  HoldingsData,
  PnlData,
  PositionRow,
} from "@nraialgo/contracts";

interface Inputs {
  pnl: PnlData | null;
  holdings: HoldingsData | null;
  positions: PositionRow[] | null;
  expectedProviders: string[];
  receivedProviders: string[];
}

type Check = CalculationReconciliationData["checks"][number];

const unique = (values: string[]) => [...new Set(values)].sort();

function safePaise(rupees: number): number | null {
  const value = Math.round(rupees * 100);
  return Number.isSafeInteger(value) ? value : null;
}

function compare(
  id: string,
  label: string,
  expectedPaise: number | null,
  actualPaise: number | null,
  reason: string,
  tolerancePaise = 1,
  unit: Check["unit"] = "paise",
): Check {
  if (expectedPaise === null || actualPaise === null) {
    return {
      id,
      label,
      status: "not_evaluable",
      unit,
      expectedValue: expectedPaise,
      actualValue: actualPaise,
      difference: null,
      tolerance: tolerancePaise,
      reason,
    };
  }
  const differencePaise = actualPaise - expectedPaise;
  const matched = Math.abs(differencePaise) <= tolerancePaise;
  return {
    id,
    label,
    status: matched ? "matched" : "mismatch",
    unit,
    expectedValue: expectedPaise,
    actualValue: actualPaise,
    difference: differencePaise,
    tolerance: tolerancePaise,
    reason: matched ? null : reason,
  };
}

/**
 * Broker-neutral arithmetic and reconciliation.
 *
 * The service never estimates charges, previous closes, quantities or missing
 * accounts. A total is only emitted when every row needed for that total has
 * the required inputs; otherwise both the metric and its check remain explicitly
 * not evaluable. Broker values are preserved as the reported side of a check --
 * this service diagnoses differences, it does not silently overwrite them.
 */
export function calculateAndReconcilePortfolio(inputs: Inputs): CalculationReconciliationData {
  const expectedProviders = unique(inputs.expectedProviders);
  const receivedProviders = unique(inputs.receivedProviders);
  const positions = inputs.positions ?? [];
  const holdings = inputs.holdings?.holdings ?? [];
  const balances = inputs.holdings?.brokerBalances ?? [];

  const openPositionValues = positions.map((row) => safePaise(
    (row.lastPrice - row.averagePrice) * row.quantity * row.multiplier,
  ));
  const positionsWithCalculatedOpenPnl = openPositionValues.filter((value) => value !== null).length;
  const openPositionPnlPaise = positions.length > 0 && positionsWithCalculatedOpenPnl === positions.length
    ? openPositionValues.reduce<number>((sum, value) => sum + value!, 0)
    : null;

  const dayMtmValues = positions.map((row) => row.mtmPaise ?? (
    row.previousClose !== null && row.previousClose !== undefined
      ? safePaise((row.lastPrice - row.previousClose) * row.quantity * row.multiplier)
      : null
  ));
  const positionsWithDayMtm = dayMtmValues.filter((value) => value !== null).length;
  const dayMtmPaise = positions.length > 0 && positionsWithDayMtm === positions.length
    ? dayMtmValues.reduce<number>((sum, value) => sum + value!, 0)
    : null;

  const holdingValuations = holdings.map((row) => row.ltpPaise === null || row.ltpPaise === undefined
    ? null
    : Math.round(row.quantity * row.ltpPaise));
  const holdingsWithValuationInputs = holdingValuations.filter((value) => value !== null).length;
  const holdingsMarketValuePaise = holdings.length > 0 && holdingsWithValuationInputs === holdings.length
    ? holdingValuations.reduce<number>((sum, value) => sum + value!, 0)
    : null;
  const holdingsInvestedPaise = holdings.length > 0 && holdings.every((row) => row.investedPaise !== null && row.investedPaise !== undefined)
    ? holdings.reduce((sum, row) => sum + row.investedPaise!, 0)
    : null;
  const holdingsUnrealizedPaise = holdings.length > 0 && holdings.every((row) => row.unrealizedPaise !== null && row.unrealizedPaise !== undefined)
    ? holdings.reduce((sum, row) => sum + row.unrealizedPaise!, 0)
    : null;

  const checks: Check[] = [
    compare(
      "gross-pnl-identity",
      "Gross P&L = realised + unrealised",
      inputs.pnl ? inputs.pnl.realisedPaise + inputs.pnl.unrealisedPaise : null,
      inputs.pnl?.grossPaise ?? null,
      "Broker gross P&L does not equal realised plus unrealised P&L.",
      0,
    ),
    compare(
      "net-pnl-identity",
      "Net P&L = gross P&L − charges",
      inputs.pnl?.chargesPaise === null || inputs.pnl?.chargesPaise === undefined
        ? null
        : inputs.pnl.grossPaise - inputs.pnl.chargesPaise,
      inputs.pnl?.netPaise ?? null,
      "Net P&L cannot be reconciled until the broker supplies charges and net P&L.",
      0,
    ),
    compare(
      "position-unrealised-total",
      "Calculated open-position P&L = broker unrealised P&L",
      openPositionPnlPaise,
      inputs.pnl?.unrealisedPaise ?? null,
      inputs.positions === null
        ? "The broker did not supply a complete open-position set."
        : "Calculated open-position P&L differs from broker unrealised P&L.",
    ),
    compare(
      "holdings-market-value",
      "Calculated holding market value = broker holding value",
      holdingsMarketValuePaise,
      holdings.length > 0 ? holdings.reduce((sum, row) => sum + row.marketValuePaise, 0) : null,
      "One or more holdings lacks a usable LTP, or calculated market value differs from the broker value.",
    ),
    compare(
      "holdings-unrealised-identity",
      "Holding unrealised P&L = market value − invested value",
      holdingsMarketValuePaise !== null && holdingsInvestedPaise !== null
        ? holdingsMarketValuePaise - holdingsInvestedPaise
        : null,
      holdingsUnrealizedPaise,
      "One or more holdings lacks average-price or unrealised-P&L inputs.",
    ),
    compare(
      "provider-coverage",
      "All configured brokers are represented",
      expectedProviders.length,
      expectedProviders.filter((provider) => receivedProviders.includes(provider)).length,
      "One or more configured brokers is missing from the calculation set.",
      0,
      "count",
    ),
  ];

  // Missing broker coverage makes the result partial; reserve "mismatch" for
  // contradictory arithmetic among values that were actually received.
  const hasMismatch = checks.some((check) => check.id !== "provider-coverage" && check.status === "mismatch");
  const hasUnknown = checks.some((check) => check.status === "not_evaluable")
    || checks.some((check) => check.id === "provider-coverage" && check.status === "mismatch");

  return {
    overallStatus: hasMismatch ? "mismatch" : hasUnknown ? "partial" : "reconciled",
    coverage: {
      expectedProviders,
      receivedProviders,
      positionsReported: positions.length,
      positionsWithDayMtm,
      positionsWithCalculatedOpenPnl,
      holdingsReported: holdings.length,
      holdingsWithValuationInputs,
      brokerBalancesReported: balances.length,
    },
    calculated: {
      dayMtmPaise,
      openPositionPnlPaise,
      holdingsMarketValuePaise,
      holdingsInvestedPaise,
      holdingsUnrealizedPaise,
      availableMarginPaise: inputs.holdings?.availableMarginPaise ?? null,
      usedMarginPaise: inputs.holdings?.usedMarginPaise ?? null,
      collateralPaise: inputs.holdings?.collateralPaise ?? null,
    },
    checks,
  };
}
