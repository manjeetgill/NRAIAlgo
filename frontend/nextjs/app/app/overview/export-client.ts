import type { OverviewSnapshot } from "@nraialgo/contracts";

export function printEodReport() {
  window.print();
}

export function downloadEodAuditPack(snapshot: OverviewSnapshot) {
  const payload = {
    exportedAt: new Date().toISOString(),
    format: "nraialgo-eod-audit-v1",
    snapshot,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `nraialgo-eod-audit-${snapshot.session.data?.lastCompletedSession ?? snapshot.generatedAt.slice(0, 10)}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
