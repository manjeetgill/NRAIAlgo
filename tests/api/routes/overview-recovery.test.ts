import Fastify, {type FastifyInstance} from 'fastify';
import sensible from '@fastify/sensible';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import { OVERVIEW_SNAPSHOT_FIXTURES } from "../../fixtures/overview";
import { type OverviewSnapshot } from "@nraialgo/contracts";
import type {Store} from '../../../apps/api/src/database.js';
import type {credentialVault} from '../../../apps/api/src/credential-vault.js';
import {buildOverviewSnapshot,loadOverviewInputs} from '../../../apps/api/src/build-overview-snapshot.js';
import {isFullyReconciledForPerformance,overviewRoutes} from '../../../apps/api/src/routes/overview.js';

const managers=vi.hoisted(()=>{
  const manager=()=>({ensure:vi.fn(),needsReconciliation:vi.fn(()=>false),reconciliationVersion:vi.fn(()=>7),reconciled:vi.fn(),overlay:vi.fn((value:unknown)=>value),prune:vi.fn(),close:vi.fn()});
  return {zerodha:manager(),kotak:manager()};
});
vi.mock('../../../apps/api/src/market-data/live-overview.js',()=>({LiveOverview:class{constructor(){return managers.zerodha;}}}));
vi.mock('../../../apps/api/src/market-data/kotak-live-overview.js',()=>({KotakLiveOverview:class{constructor(){return managers.kotak;}}}));
vi.mock('../../../apps/api/src/build-overview-snapshot.js',()=>({buildOverviewSnapshot:vi.fn(),loadOverviewInputs:vi.fn()}));
vi.mock('../../../apps/api/src/routes/auth.js',()=>({requireAuth:()=>async(request:{auth?:unknown})=>{request.auth={workspaceId:'review-workspace',accountId:'A',email:'test@example.invalid'};}}));

let app:FastifyInstance;
const base=():OverviewSnapshot=>({...structuredClone(OVERVIEW_SNAPSHOT_FIXTURES['market-open']),generatedAt:new Date().toISOString()});
beforeEach(async()=>{
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-09-22T06:00:00Z'));vi.clearAllMocks();
  managers.zerodha.needsReconciliation.mockReturnValue(false);managers.kotak.needsReconciliation.mockReturnValue(false);
  vi.mocked(loadOverviewInputs).mockResolvedValue({session:base().session,zerodha:{apiKey:'test',accessToken:'test',accountId:'Z'},kotak:{session:{token:'test',sid:'test',baseUrl:'https://mis.kotaksecurities.com'},accountId:'K'}});
  const store={transaction:vi.fn(async(callback:(query:unknown)=>unknown)=>callback(undefined))} as unknown as Store;
  app=Fastify();await app.register(sensible);
  await app.register(overviewRoutes(store,{} as ReturnType<typeof credentialVault>));await app.ready();
});
afterEach(async()=>{await app.close();vi.useRealTimers();});

describe('overview failure recovery without a database or broker calls',()=>{
  it('accepts only complete reconciled broker coverage for persisted performance',()=>{
    const complete=base();complete.configuredProviders=['zerodha','kotak'];complete.pnl.status='available';complete.brokerReconciliation={zerodha:{accountId:'Z',status:'confirmed',asOf:complete.generatedAt},kotak:{accountId:'K',status:'confirmed',asOf:complete.generatedAt}};
    expect(isFullyReconciledForPerformance(complete)).toBe(true);
    const degraded=structuredClone(complete);degraded.pnl.status='degraded';
    expect(isFullyReconciledForPerformance(degraded)).toBe(false);
    const missing=structuredClone(complete);missing.brokerReconciliation!.kotak!.status='failed';
    expect(isFullyReconciledForPerformance(missing)).toBe(false);
    const includesIcici=structuredClone(complete);includesIcici.configuredProviders=['zerodha','kotak','icici'];
    expect(isFullyReconciledForPerformance(includesIcici)).toBe(false);
  });
  it('returns controlled 503 during an empty-cache cooldown and recovers after it',async()=>{
    managers.kotak.needsReconciliation.mockReturnValue(true);
    vi.mocked(buildOverviewSnapshot).mockRejectedValueOnce(new Error('private upstream detail')).mockResolvedValueOnce(base());
    const first=await app.inject('/v1/overview');expect(first.statusCode).toBe(503);expect(first.body).not.toContain('private upstream');
    const second=await app.inject('/v1/overview');expect(second.statusCode).toBe(503);
    expect(buildOverviewSnapshot).toHaveBeenCalledTimes(1);expect(managers.zerodha.overlay).not.toHaveBeenCalled();
    vi.setSystemTime(Date.now()+2001);
    expect((await app.inject('/v1/overview')).statusCode).toBe(200);
    expect(buildOverviewSnapshot).toHaveBeenCalledTimes(2);
  });
  it('clears only the successful broker, including confirmed empty positions',async()=>{
    const snapshot=base();
    snapshot.brokerReconciliation={zerodha:{accountId:'Z',status:'failed',asOf:null},kotak:{accountId:'K',status:'confirmed',asOf:snapshot.generatedAt}};
    snapshot.positions={status:'degraded',source:'kotak',asOf:snapshot.generatedAt,version:1,reason:'Zerodha unavailable',data:[]};
    vi.mocked(buildOverviewSnapshot).mockResolvedValueOnce(snapshot);
    expect((await app.inject('/v1/overview')).statusCode).toBe(200);
    expect(managers.kotak.reconciled).toHaveBeenCalledWith('review-workspace',7);
    expect(managers.zerodha.reconciled).not.toHaveBeenCalled();
  });
  it('does not clear either reconciliation barrier on a failed read',async()=>{
    vi.mocked(buildOverviewSnapshot).mockRejectedValueOnce(new Error('failed'));
    await app.inject('/v1/overview');
    expect(managers.zerodha.reconciled).not.toHaveBeenCalled();expect(managers.kotak.reconciled).not.toHaveBeenCalled();
  });
  it('retains the original timestamps after a failed background refresh',async()=>{
    const snapshot=base();vi.mocked(buildOverviewSnapshot).mockResolvedValueOnce(snapshot).mockRejectedValueOnce(new Error('failed'));
    await app.inject('/v1/overview');vi.setSystemTime(Date.now()+11000);
    const response=await app.inject('/v1/overview');expect(response.statusCode).toBe(200);
    expect(response.json().generatedAt).toBe(snapshot.generatedAt);
    expect((await app.inject('/v1/overview')).json().generatedAt).toBe(snapshot.generatedAt);
    expect(buildOverviewSnapshot).toHaveBeenCalledTimes(2);
  });
  it('rejects reconciliation evidence for a different account',async()=>{
    const snapshot=base();snapshot.brokerReconciliation={kotak:{accountId:'another-account',status:'confirmed',asOf:snapshot.generatedAt}};
    vi.mocked(buildOverviewSnapshot).mockResolvedValueOnce(snapshot);await app.inject('/v1/overview');
    expect(managers.kotak.reconciled).not.toHaveBeenCalled();
  });
});
