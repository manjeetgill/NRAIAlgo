import type {KotakInputs} from '../build-overview-snapshot.js';
import {KotakEventSchema,startKotakSdk,type KotakSdkErrorCode} from '../broker-auth/kotak-sdk.js';
import type {z} from 'zod';

export type KotakMessage=z.infer<typeof KotakEventSchema>;
export type KotakState='connecting'|'streaming'|'reconnecting'|'unavailable';
export interface KotakFeed {subscribe(keys:string[]):void;stop():void}
export type KotakFactory=(credentials:KotakInputs,receive:(message:KotakMessage)=>void)=>KotakFeed;

/** The official Python SDK owns transport and binary parsing. Node owns
 * account isolation, freshness and valuation through KotakLiveOverview. */
export function createKotakFeed(credentials:KotakInputs,receive:(message:KotakMessage)=>void,launch:typeof startKotakSdk=startKotakSdk):KotakFeed{
  let stopped=false,desired:string[]=[],sent='',attempts=0,generation=0;
  let bridge:ReturnType<typeof startKotakSdk>|undefined;
  let retry:ReturnType<typeof setTimeout>|undefined;
  let stable:ReturnType<typeof setTimeout>|undefined;
  const channels={market:false,orders:false};
  const unavailable=()=>{for(const channel of ['market','orders'] as const)receive({type:'state',channel,state:'unavailable'});};
  function connect(){
    if(stopped)return;
    const id=++generation;
    channels.market=false;channels.orders=false;
    sent='';
    const next=launch('stream',credentials,value=>{
      if(stopped||id!==generation)return;
      const parsed=KotakEventSchema.safeParse(value);
      if(!parsed.success){failed(id);return;}
      if(parsed.data.type==='state'&&parsed.data.state==='unavailable'){failed(id);return;}
      if(parsed.data.type==='state'){
        channels[parsed.data.channel]=parsed.data.state==='streaming';
        if(!channels.market||!channels.orders){clearTimeout(stable);stable=undefined;}
        else if(!stable)stable=setTimeout(()=>{stable=undefined;if(!stopped&&id===generation)attempts=0;},60_000);
      }
      receive(parsed.data);
    },code=>failed(id,code));
    if(stopped||id!==generation){next.stop();return;}
    bridge=next;
    update();
  }
  function failed(id:number,code?:KotakSdkErrorCode){
    if(stopped||retry||id!==generation)return;
    generation++;
    clearTimeout(stable);stable=undefined;
    bridge?.stop();bridge=undefined;unavailable();
    // Authentication/configuration errors need operator action. Transient
    // exhaustion opens a cooldown circuit, never permanently retires a feed.
    if(code==='TOTP_LOGIN'||code==='MPIN_VERIFY'||code==='SDK_MISSING')return;
    const exhausted=attempts>=10;
    const delay=exhausted?300_000:Math.min(30_000,1000*2**attempts++);
    retry=setTimeout(()=>{retry=undefined;connect();},delay);
  }
  function update(){
    const key=JSON.stringify(desired);
    if(bridge&&key!==sent){bridge.send({op:'subscribe',keys:desired});sent=key;}
  }
  connect();
  return {
    subscribe(keys){
      if(stopped)return;
      const valid=[...new Set(keys)].filter(key=>/^(nse_cm|nse_fo|cde_fo|nse_com|bse_cm|bse_fo|bse_cd|bse_co|mcx_fo|ncd_co)\|[1-9]\d*$/.test(key)).sort();
      if(valid.length>3000){bridge?.stop();unavailable();return;}
      desired=valid;update();
    },
    stop(){stopped=true;generation++;clearTimeout(retry);clearTimeout(stable);bridge?.stop();},
  };
}
