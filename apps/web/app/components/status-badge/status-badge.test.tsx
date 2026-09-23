import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusBadge } from "./status-badge";

describe("StatusBadge", () => {
  it("renders the given label", () => {
    render(<StatusBadge kind="positive" label="Connected" />);

    expect(screen.getByText("Connected")).toBeInTheDocument();
  });
});
