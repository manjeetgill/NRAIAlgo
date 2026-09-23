# Manual validation and follow-up fixes — 22 September 2026

## Release decision

**Not approved for production promotion yet.** The local app passed the checks
below after fixes. This is not a claim that every broker value is correct or that
the application is bug-free. No code was committed or deployed during this pass.
The existing private staging stack responded, but it is not the new working tree.

## Scope and method

Manually operated the running app at `http://localhost:3010` in the in-app browser:
actual after-close session, all four layout previews, each broker selector,
Cash Holdings, Broker Gateways, login, invitation and recovery screens. Used
rendered tables for arithmetic and ordering checks. Tested the narrow default
browser view and a desktop view; restored viewport and theme afterwards.

Only ICICI had an authorized local session. Zerodha and Kotak were unconfigured
and unauthorized. Their real portfolios could not be checked. No credentials
were changed, trades placed, accounts created or passwords reset.

## Bugs fixed in this pass

1. Closed/pre-open holdings summaries omitted ICICI although shared tables
   included it. They now use the same selected holding rows and identify an
   incomplete subtotal instead of suggesting a complete portfolio.
2. The actual after-close view was labelled as a layout preview. Automatic mode
   now displays Session Closed; explicit previews retain their warning.
3. ICICI capital rendered two headings and an unknown generic status alongside a
   successful snapshot. It now has one normal gateway card with reported holding
   count and REST-snapshot status. Bank balance/allocation details are limited to
   the individual ICICI view, while shared holdings/positions/orders remain in
   consolidated views.
4. Layout changes remounted ICICI polling. The overview now owns one poll across
   all layout variants.
5. A hanging response body could ignore abort and prevent the next ICICI poll.
   A deadline race now covers both headers and body; regression test added.
6. Known position rows were accompanied by an "Unavailable" position count.
   Partial feeds now show the reported count with a partial-coverage label.
7. Snapshot downloads omitted ICICI data. Downloads now include the scoped
   overview, selected broker and applicable ICICI read model.
8. Cash Holdings offered only Refresh ICICI, even in other broker views. Refresh
   now targets selected accounts. Status messages are scoped; ISIN search added.
9. Readiness said there was no authenticated user despite a signed-in user.
   It now accurately says platform MFA is not verified by that service.
10. Removed remaining unreachable compact-table detailed-layout branches and
    clarified incomplete P&L/provenance wording.

## Manual check results

| Area | Test | Result |
| --- | --- | --- |
| Market layout/broker matrix | Market open, pre-open, after-close, weekend × consolidated, Zerodha, Kotak, ICICI | All 16 rendered without an application error; execution remained locked. |
| Broker isolation | Check ICICI holding/position in each matrix cell | Present in consolidated/ICICI; absent in Zerodha/Kotak. Repeated after waiting for the actual data response. |
| Actual session | Return from preview to Auto | Session Closed and actual after-close state; preview warning removed. |
| Capital | Consolidated vs ICICI-specific bank fields | Consolidated contains one standard ICICI gateway card and no ICICI-only bank/allocation block. |
| Holdings summary | Closed summary vs detailed portfolio | Matching known ICICI valuation; consolidated coverage clearly incomplete. |
| Cash Holdings columns | Inspect table headers | All 13 detailed columns present, with unknown analytics shown as unavailable. |
| Holdings arithmetic | All 122 rendered ICICI rows | Zero mismatches within ₹0.02 for quantity × price, quantity × average cost, and value − investment. |
| Summary arithmetic | Sum displayed market value, unrealized and daily P&L | Matches the three displayed ICICI summary cards to the paise after rounding. This validates internal arithmetic, not independent broker-ledger correctness. |
| Holding search | Lowercase instrument query; clear using keyboard | Correct single matching row and filtered summaries; clearing restores 122 holdings. |
| Numeric sorting | Quantity, day change, current value, unrealized P&L | Actual values across all 122 rows sorted correctly ascending; ascending/descending header toggles verified. |
| Pledge filter | Pledged, not pledged, unknown, all | Unknown pledge data is not incorrectly classified as free or pledged. |
| Broker filter | Four Cash Holdings scopes | ICICI rows only in ICICI/consolidated; other scopes show unavailable, not an empty verified portfolio. |
| Compact overview | Holdings region | Bounded scroll region and keyboard focus target retained; full detail linked separately. |
| Navigation | Mobile menu → Broker Gateways; desktop sidebar → Cash Holdings/Algo Terminal | Routes load; mobile drawer closes after navigation. Planned routes remain placeholders. |
| Broker setup | Zerodha/Kotak/ICICI tabs | Correct setup/authorization steps; saved secrets not displayed; incomplete forms cannot save/authorize. |
| Login | Setup status then empty submit | Setup resolves and Sign in becomes enabled; required email field receives focus on empty submit. |
| Recovery | Forgot password/back | Explains owner-issued 30-minute code, no automated email, minimum password length. No reset submitted. |
| Registration | Create new account/back | Explains owner invitation, 24-hour expiry and separate workspace. No account created. |
| News | Expand/collapse and unmatched search | Explicit no-matching-announcements state; search cleared afterwards. |
| Themes/layout | Light/dark and narrow/desktop views | Rendered successfully; wide financial tables retain their scroll container. |
| Browser errors | Inspect captured error log | One historical development missing-file error predates this pass; no new application error observed in the tested flows. |

## Automated and container checks

- **320 tests passed:** API 204, contracts 17, web 99.
- Workspace ESLint, type checks and `git diff --check` passed.
- Both current Docker targets built: API `nraialgo-api:manual-review`, web
  `nraialgo-web:manual-review` (local test tags, not promoted artifacts).
- Web container started with read-only root filesystem, dropped capabilities and
  no-new-privileges under its non-root user. Login returned 200 and the developer
  playground returned 404.
- Local unauthenticated overview returned 401.
- Existing private staging tunnel: login 200, setup reports already initialized
  with bootstrap disabled, unauthenticated overview 401. These checks used the
  existing tunnel, not a newly deployed release or a public-domain TLS audit.

## Unresolved findings and required checks

1. **Multi-tab ICICI rate limiting:** six reads/minute per IP can produce 429 under
   ordinary multi-tab use. Observed during this pass. Proposed 60/minute with a
   20-second workspace/session-bound cache was blocked by the safety reviewer
   pending explicit user approval. No rate-limit or cache change was applied.
   Layout-switch polling duplication is fixed, but separate tabs still share the
   existing limit. Do not treat this item as resolved.
2. **Broker verification:** authorize Zerodha and Kotak, then compare actual
   holdings, positions, orders, margins and P&L against their account reports.
   ICICI daily P&L remains a labelled holdings estimate, not session trading P&L.
   Some ICICI order exchange requests were degraded; unavailable values remain
   unavailable. MCX product details and missing analytics are not inferred.
3. **News sources:** only a subset reported healthy. The UI exposes this rather
   than claiming all feeds are connected. Provider availability/configuration
   requires separate verification.
4. **Full authentication lifecycle:** authenticated viewing was tested using the
   existing session. Fresh login, invitation redemption, password reset and
   session revocation still need designated test accounts and approved actions.
5. **Production release:** commit the intended change set, deploy that exact
   artifact to staging, verify migration/runtime role, reconnect all brokers,
   check public HTTPS/cookie behavior, perform an isolated backup restore and
   validate restart/recovery/monitoring on the Droplet. None is replaced by local
   Docker builds or the existing staging login check.

See `production-readiness-review.md` for the broader release gate checklist.
