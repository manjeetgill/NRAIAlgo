import { describe, expect, it } from "vitest";
import { iciciPositions } from "../../../../frontend/nextjs/app/app/overview/icici-model";

describe("ICICI position normalization", () => {
  it("prefers broker P&L and carries broker-reported margin", () => {
    const [position] = iciciPositions([{ stock_code: "NIFTY", action: "Buy", quantity: "10", average_price: "100", ltp: "105", pnl: "75", margin_amount: "250" }], "IC1", "2026-09-23T01:00:00.000Z");
    expect(position).toMatchObject({ quantity: 10, pnlPaise: 7500, marginPaise: 25000 });
  });

  it("does not substitute a price-based estimate for missing broker P&L", () => {
    const [sell] = iciciPositions([{ stock_code: "TEST", action: "Sell", quantity: "10", average_price: "100", ltp: "90", pnl: null }], "IC1", "2026-09-23T01:00:00.000Z");
    expect(sell).toMatchObject({ quantity: -10, pnlPaise: null });
    const [unknown] = iciciPositions([{ stock_code: "TEST", action: "Sell", quantity: "10", average_price: null, ltp: "90", pnl: null }], "IC1", "2026-09-23T01:00:00.000Z");
    expect(unknown?.pnlPaise).toBeNull();
  });
});

it("calculates a separately identified ICICI open-position estimate without changing reported P&L", () => {
  const [row] = iciciPositions([{stock_code:"TEST",exchange_code:"NFO",product_type:"Options",action:"Sell",quantity:"10",average_price:"100",ltp:"90",pnl:null}], "IC1", "2026-09-23T01:00:00.000Z");
  expect(row).toMatchObject({pnlPaise:null,estimatedPnlPaise:10000});
  const [missing] = iciciPositions([{exchange_code:"NFO",product_type:"Options",action:"Sell",quantity:"10",average_price:null,ltp:"90"}], "IC1", "2026-09-23T01:00:00.000Z");
  expect(missing?.estimatedPnlPaise).toBeNull();
});

it("calculates ICICI daily MTM from the previous close and current streamed price", () => {
  const [buy] = iciciPositions([{stock_code:"TEST",exchange_code:"NFO",product_type:"Options",action:"Buy",quantity:"10",average_price:"80",previous_close:"100",ltp:"105",pnl:null}], "IC1", "2026-09-23T01:00:00.000Z");
  const [sell] = iciciPositions([{stock_code:"TEST",exchange_code:"NFO",product_type:"Options",action:"Sell",quantity:"10",average_price:"120",previous_close:"100",ltp:"105",pnl:null}], "IC1", "2026-09-23T01:00:00.000Z");
  expect(buy).toMatchObject({previousClose:100,mtmPaise:5000});
  expect(sell).toMatchObject({previousClose:100,mtmPaise:-5000});
});
