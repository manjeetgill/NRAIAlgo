/** Session-level P&L history and the multi-session performance stats
 * derived from it (day win rate, max drawdown, Sharpe).
 *
 * These are fundamentally different from every other panel in this app:
 * everything else only ever needs *today's* broker state, but a win rate,
 * a drawdown or a Sharpe ratio is meaningless without a history of prior
 * sessions. There was no such history anywhere in this codebase -- this
 * module is exactly that, and nothing else. It stores one row per
 * workspace per completed trading day (gross P&L only: chargesPaise is
 * still unknown for every provider, so a true net figure isn't available
 * to record either -- see panels.ts's own reasoning for why chargesPaise
 * stays null).
 */
import type { Query } from "./database/database.js";

/** Below this many recorded sessions, a Sharpe ratio is not statistically
 * meaningful -- reporting one anyway would look precise while being noise.
 * 20 sessions is roughly a trading month, a common minimum in practice. */
export const SHARPE_MIN_SESSIONS = 20;
const TRADING_DAYS_PER_YEAR = 252;
const VERIFIED_COVERAGE = "fully-reconciled-v1";

export interface SessionPerformance {
  sessionsRecorded: number;
  sessionsRequiredForSharpe: number;
  /** Percentage of recorded sessions with grossPaise > 0, 0-100. Null only
   * when there is no history at all yet. Day-level, not trade-level -- see
   * the UI label ("Day win rate"), which must never imply per-trade
   * granularity this doesn't have. */
  dayWinRatePct: number | null;
  /** Largest peak-to-trough decline in the cumulative gross P&L series.
   * Needs at least two sessions to mean anything (one session has no
   * "peak" to fall from). */
  maxDrawdownPaise: number | null;
  /** Annualized Sharpe of daily gross P&L. Null below SHARPE_MIN_SESSIONS. */
  sharpe: number | null;
}

const EMPTY_PERFORMANCE: SessionPerformance = {
  sessionsRecorded: 0,
  sessionsRequiredForSharpe: SHARPE_MIN_SESSIONS,
  dayWinRatePct: null,
  maxDrawdownPaise: null,
  sharpe: null,
};

/** Idempotent per (workspace, trading_day): the first after-close read of a
 * day inserts it, and later reads that evening (as reconciliation continues
 * -- see market-closed-screen's own "Account updates and reconciliation
 * continue after market close") update it, converging on the final figure
 * rather than freezing whatever the very first after-close snapshot saw. */
export async function recordSessionGrossPnl(
  query: Query,
  workspaceId: string,
  tradingDay: string,
  grossPaise: number,
): Promise<void> {
  await query(
    `INSERT INTO session_pnl_history (workspace_id, trading_day, gross_paise, coverage_key, recorded_at)
     VALUES ($1,$2,$3,$4,now())
     ON CONFLICT (workspace_id, trading_day) DO UPDATE SET gross_paise=EXCLUDED.gross_paise, coverage_key=EXCLUDED.coverage_key, recorded_at=now()`,
    [workspaceId, tradingDay, grossPaise, VERIFIED_COVERAGE],
  );
}

export async function loadSessionPerformance(query: Query, workspaceId: string): Promise<SessionPerformance> {
  const rows = await query<{ gross_paise: string }>(
    "SELECT gross_paise::text FROM session_pnl_history WHERE workspace_id=$1 AND coverage_key=$2 ORDER BY trading_day ASC",
    [workspaceId, VERIFIED_COVERAGE],
  );
  const series = rows.map((row) => Number(row.gross_paise));
  const sessionsRecorded = series.length;
  if (sessionsRecorded === 0) {
    return EMPTY_PERFORMANCE;
  }

  const dayWinRatePct = Math.round((series.filter((value) => value > 0).length / sessionsRecorded) * 1000) / 10;

  let maxDrawdownPaise: number | null = null;
  if (sessionsRecorded >= 2) {
    let peak = 0;
    let cumulative = 0;
    let worstDrop = 0;
    for (const value of series) {
      cumulative += value;
      peak = Math.max(peak, cumulative);
      worstDrop = Math.min(worstDrop, cumulative - peak);
    }
    maxDrawdownPaise = Math.abs(worstDrop);
  }

  let sharpe: number | null = null;
  if (sessionsRecorded >= SHARPE_MIN_SESSIONS) {
    const mean = series.reduce((sum, value) => sum + value, 0) / sessionsRecorded;
    const variance = series.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (sessionsRecorded - 1);
    const stdev = Math.sqrt(variance);
    sharpe = stdev > 0 ? Number(((mean / stdev) * Math.sqrt(TRADING_DAYS_PER_YEAR)).toFixed(2)) : null;
  }

  return { sessionsRecorded, sessionsRequiredForSharpe: SHARPE_MIN_SESSIONS, dayWinRatePct, maxDrawdownPaise, sharpe };
}
