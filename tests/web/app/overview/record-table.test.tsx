import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { RecordTable } from "../../../../frontend/nextjs/app/app/overview/record-table";

it("paginates, sorts, selects columns and retains zero-valued detail fields", async () => {
  const rows = Array.from({length:26},(_,index)=>({symbol:`S${String(index).padStart(2,"0")}`,quantity:index}));
  render(<RecordTable rows={rows} label="Test records" id={row=>row.symbol} details={row=>({quantity:row.quantity,missing:null})} columns={[{key:"symbol",label:"Instrument",value:row=>row.symbol},{key:"quantity",label:"Quantity",value:row=>row.quantity}]} />);
  expect(screen.queryByText("S25")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"Next"}));
  expect(screen.getByText("S25")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"Quantity"}));
  expect(screen.getByText("Page 1 of 2 · 25 per page")).toBeInTheDocument();
  fireEvent.click(screen.getByText("Columns"));
  fireEvent.click(screen.getByRole("checkbox",{name:"Quantity"}));
  expect(screen.queryByRole("columnheader",{name:"Quantity"})).not.toBeInTheDocument();
  fireEvent.click(screen.getAllByText("View all broker fields")[0]!);
  expect(await screen.findByText("Not supplied")).toBeInTheDocument();
  expect(screen.getByText("0")).toBeInTheDocument();
});
