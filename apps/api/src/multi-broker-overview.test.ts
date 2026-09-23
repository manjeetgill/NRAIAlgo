import { describe, expect, it } from 'vitest';
import { OVERVIEW_SNAPSHOT_FIXTURES } from '@nraialgo/contracts';
import { buildOverviewSnapshot, type SnapshotDeps } from './build-overview-snapshot.js';

describe('multi-broker dashboard composition',()=>{
 it('starts both broker reads before either completes',async()=>{
  const fixture=OVERVIEW_SNAPSHOT_FIXTURES['market-open'];
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const started:string[]=[];
  const portfolio={holdings:fixture.holdings.data!,pnl:fixture.pnl.data!,positions:[]};
  const deps:SnapshotDeps={fetchNseIndexCloses:async()=>[],fetchZerodhaPortfolio:async()=>{started.push('zerodha');await gate;return portfolio;},fetchKotakPortfolio:async()=>{started.push('kotak');await gate;return portfolio;}};
  const pending=buildOverviewSnapshot({session:fixture.session,zerodha:{apiKey:'test',accessToken:'test',accountId:'Z'},kotak:{session:{token:'test',sid:'test',baseUrl:'https://example.com'},accountId:'K'}},new Date(fixture.generatedAt),fixture.scope,deps);
  try { expect(started).toEqual(['zerodha','kotak']); } finally { release(); await pending; }
 });
 it('includes both broker positions and marks partial reads degraded',async()=>{
  const fixture=OVERVIEW_SNAPSHOT_FIXTURES['market-open'];
  const now=new Date(fixture.generatedAt);
  const position={provider:'zerodha',accountId:'Z',instrumentToken:1,exchange:'NFO',symbol:'TEST',product:'NRML',quantity:1,multiplier:1,averagePrice:100,lastPrice:110,pnlPaise:1000,asOf:fixture.generatedAt,fresh:false};
  const deps:SnapshotDeps={fetchNseIndexCloses:async()=>[],fetchZerodhaPortfolio:async()=>({holdings:fixture.holdings.data!,pnl:fixture.pnl.data!,positions:[position]}),fetchKotakPortfolio:async()=>({holdings:fixture.holdings.data!,pnl:fixture.pnl.data!,positions:[{...position,provider:'kotak',accountId:'K'}]})};
  const inputs={session:fixture.session,zerodha:{apiKey:'test',accessToken:'test',accountId:'Z'},kotak:{session:{token:'test',sid:'test',baseUrl:'https://example.com'},accountId:'K'}};
  const result=await buildOverviewSnapshot(inputs,now,fixture.scope,deps);
  expect(result.positions?.data?.map(p=>p.provider)).toEqual(['zerodha','kotak']);
  expect(result.pnl.data?.grossPaise).toBe(fixture.pnl.data!.grossPaise*2);
  const failed=await buildOverviewSnapshot(inputs,now,fixture.scope,{...deps,fetchKotakPortfolio:async()=>{throw Error('unavailable');}});
  expect(failed.positions?.status).toBe('degraded');
  expect(failed.pnl.status).toBe('degraded');
  expect(failed.brokerReconciliation).toEqual({zerodha:{accountId:'Z',status:'confirmed',asOf:fixture.holdings.data!.accountAsOf},kotak:{accountId:'K',status:'failed',asOf:null}});
  const kotakOnly=await buildOverviewSnapshot(inputs,now,fixture.scope,{...deps,fetchZerodhaPortfolio:async()=>{throw Error('unavailable');}});
  expect(kotakOnly.positions?.status).toBe('degraded');
  expect(kotakOnly.brokerReconciliation?.kotak?.status).toBe('confirmed');
  expect(kotakOnly.brokerReconciliation?.zerodha?.status).toBe('failed');
 });
});
