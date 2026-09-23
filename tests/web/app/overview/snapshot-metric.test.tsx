import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { SnapshotMetric } from "../../../../frontend/nextjs/app/app/overview/snapshot-metric";

it("retains the last confirmed metric with a timestamp and never reuses it for another broker", () => {
  const { rerender } = render(<SnapshotMetric value={12500} scope="zerodha" asOf="2026-09-23T01:00:00Z" />);
  expect(screen.getByText("₹125.00")).toBeInTheDocument();
  rerender(<SnapshotMetric value={null} scope="zerodha" />);
  expect(screen.getByText("₹125.00")).toHaveTextContent("₹125.00*");
  expect(screen.getByLabelText(/Last confirmed snapshot/)).toHaveAttribute("title", expect.stringContaining("Current refresh"));
  rerender(<SnapshotMetric value={null} scope="icici" />);
  expect(screen.queryByText("₹125.00")).not.toBeInTheDocument();
  expect(screen.getByLabelText(/No confirmed value/).parentElement).toHaveTextContent("—*");
});
