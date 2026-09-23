import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadEodAuditPack, printEodReport } from "../../../../frontend/nextjs/app/app/overview/export-client";
import { OVERVIEW_SNAPSHOT_FIXTURES } from "../../../fixtures/overview";

describe("EOD exports", () => {
  afterEach(() => vi.restoreAllMocks());

  it("opens the browser print flow for PDF export", () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    printEodReport();
    expect(print).toHaveBeenCalledOnce();
  });

  it("downloads the complete snapshot as a dated JSON audit pack", () => {
    const createObjectURL = vi.fn((_blob: Blob) => "blob:audit-pack");
    const revokeObjectURL = vi.fn();
    Object.defineProperties(URL, {
      createObjectURL: { configurable: true, value: createObjectURL },
      revokeObjectURL: { configurable: true, value: revokeObjectURL },
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    downloadEodAuditPack(OVERVIEW_SNAPSHOT_FIXTURES["after-close"]);

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(createObjectURL.mock.calls[0]?.[0]).toBeInstanceOf(Blob);
    expect(click).toHaveBeenCalledOnce();
    const anchor = click.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.download).toBe("nraialgo-eod-audit-2026-09-21.json");
    expect(anchor.href).toBe("blob:audit-pack");
    expect(anchor.isConnected).toBe(false);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:audit-pack");
  });
});
