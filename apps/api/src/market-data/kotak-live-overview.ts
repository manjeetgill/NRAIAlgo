import type { OverviewSnapshot } from "@nraialgo/contracts";
import type { KotakInputs } from "../build-overview-snapshot.js";
import { createKotakFeed, type KotakFactory, type KotakFeed, type KotakState } from "./kotak-feed.js";
import { accountIsStale, degradeAccountPanels } from "./account-freshness.js";
type Entry={credentials:KotakInputs; feed:KotakFeed;usedAt:number;market:KotakState;orders:KotakState;pending:boolean;generation:number;ticks:Map<string,{price:number;sourceAt:number;receivedAt:number}>};
export class KotakLiveOverview {
  private entries=new Map<string,Entry>();
  private generation=0;
  constructor(private factory:KotakFactory=createKotakFeed,private clock=Date.now){}
  ensure(workspace:string,credentials:KotakInputs|null){
    let entry=this.entries.get(workspace);
    if(entry && (!credentials || JSON.stringify(entry.credentials)!==JSON.stringify(credentials))){this.remove(workspace);entry=undefined;}
    if(!credentials) return;
    if(entry){entry.usedAt=this.clock();return;}
    if(this.entries.size>=32) return;
    const created:Entry={credentials,feed:{subscribe(){},stop(){}},usedAt:this.clock(),market:'connecting',orders:'connecting',pending:true,generation:++this.generation,ticks:new Map()};
    this.entries.set(workspace,created);
    created.feed=this.factory(credentials,message=>{
      if(this.entries.get(workspace)!==created) return;
      const now=this.clock();
      if(message.type==='state'){
        created[message.channel==='market'?'market':'orders']=message.state;
        if(message.channel==='market') created.ticks.clear();
        created.pending=true;created.generation=++this.generation;
      }else if(message.type==='order'){created.pending=true;created.generation=++this.generation;}
      else if(Number.isFinite(message.price)&&message.price>0&&message.sourceAt<=now+5000&&message.sourceAt>0){
        const previous=created.ticks.get(message.key);
        if(!previous||message.sourceAt>=previous.sourceAt) created.ticks.set(message.key,{price:message.price,sourceAt:message.sourceAt,receivedAt:now});
      }
    });
  }
  needsReconciliation(workspace:string){return this.entries.get(workspace)?.pending??false;}
  reconciliationVersion(workspace:string){return this.entries.get(workspace)?.generation;}
  reconciled(workspace:string,generation:number|undefined){const e=this.entries.get(workspace);if(e&&e.generation===generation)e.pending=false;}
  private remove(workspace:string){const e=this.entries.get(workspace);this.entries.delete(workspace);e?.feed.stop();}
  prune(){for(const [id,e] of this.entries)if(this.clock()-e.usedAt>60_000)this.remove(id);}
  close(){for(const id of this.entries.keys())this.remove(id);}
  overlay(base:OverviewSnapshot):OverviewSnapshot{
    const e=this.entries.get(base.scope.workspaceId);if(!e)return base;
    const now=this.clock(), iso=new Date(now).toISOString();e.usedAt=now;
    const snapshot=structuredClone(base);
    const rows=snapshot.positions?.data?.filter(p=>p.provider==='kotak'&&p.accountId===e.credentials.accountId)??[];
    const keys=rows.map(p=>`${p.exchange}|${p.instrumentToken}`);
    e.feed.subscribe(keys);
    for(const key of e.ticks.keys())if(!keys.includes(key))e.ticks.delete(key);
    const accountStale=accountIsStale(base,'kotak',e.credentials.accountId,now);
    const open=base.session.data?.calendarValid&&base.session.data.state==='market-open';
    let delta=0,updated=false,freshCount=0;
    for(const row of rows){
      row.fresh=false;
      const tick=e.ticks.get(`${row.exchange}|${row.instrumentToken}`);
      if(!open||accountStale||e.pending||e.market!=='streaming'||!tick||now-tick.receivedAt>15000||now-tick.sourceAt>15000||tick.sourceAt<Date.parse(row.asOf))continue;
      const change=Math.round((tick.price-row.lastPrice)*row.quantity*row.multiplier*100);
      row.lastPrice=tick.price;row.pnlPaise+=change;row.asOf=new Date(tick.sourceAt).toISOString();row.fresh=true;freshCount++;delta+=change;updated=true;
    }
    if(updated&&snapshot.pnl.data){snapshot.pnl.data.grossPaise+=delta;snapshot.pnl.data.unrealisedPaise+=delta;if(snapshot.pnl.data.netPaise!==null)snapshot.pnl.data.netPaise+=delta;snapshot.pnl.data.valuationAsOf=iso;snapshot.pnl.source+='+kotak-tick-estimate';}
    if(accountStale||e.pending)degradeAccountPanels(snapshot,'Kotak');
    const marketLabel=e.market==='streaming' ? !rows.length?'connected · no open positions':freshCount===rows.length?'streaming':'waiting / stale / reconciling' : e.market;
    snapshot.connections={status:'available',source:'broker-reads+market-streams',asOf:iso,version:now,reason:null,data:[...(snapshot.connections.data??[]),
      {source:`Kotak market WebSocket (${marketLabel})`,status:e.market==='streaming'?'connected':'session_ended',latencyMs:null,asOf:iso},
      {source:`Kotak order/position WebSocket (${e.orders})`,status:e.orders==='streaming'?'connected':'session_ended',latencyMs:null,asOf:iso}]};
    return snapshot;
  }
}
