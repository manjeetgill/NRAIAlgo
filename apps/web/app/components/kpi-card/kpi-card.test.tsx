import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { KpiCard } from "./kpi-card";

describe("KpiCard", () => {
  it("renders the label, value, and change", () => {
    render(<KpiCard label="NIFTY 50" value="25,124.80" change="+112.40" changePercent="+0.45%" direction="up" />);

    expect(screen.getByText("NIFTY 50")).toBeInTheDocument();
    expect(screen.getByText("25,124.80")).toBeInTheDocument();
    expect(screen.getByText("+112.40 (+0.45%)")).toBeInTheDocument();
  });
});
