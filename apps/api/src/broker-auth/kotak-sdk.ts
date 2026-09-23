import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {z} from 'zod';

const root=resolve(import.meta.dirname,'../../../..');
const ErrorCodeSchema=z.enum(['TOTP_LOGIN','MPIN_VERIFY','SDK_TIMEOUT','SDK_MISSING','SDK_UPSTREAM','SDK_INVALID_RESPONSE']);
export type KotakSdkErrorCode=z.infer<typeof ErrorCodeSchema>;
const messages:Record<KotakSdkErrorCode,string>={
  TOTP_LOGIN:'Kotak rejected the access token, mobile number, UCC or TOTP.',
  MPIN_VERIFY:'Kotak rejected the MPIN.',
  SDK_TIMEOUT:'Kotak SDK request timed out.',
  SDK_MISSING:'Kotak Python SDK runtime is not installed.',
  SDK_UPSTREAM:'Kotak SDK upstream request failed.',
  SDK_INVALID_RESPONSE:'Kotak SDK returned an invalid response.',
};
export class KotakSdkError extends Error {
  constructor(public readonly code:KotakSdkErrorCode){super(messages[code]);}
}
export const KotakEventSchema=z.discriminatedUnion('type',[
  z.object({type:z.literal('state'),channel:z.enum(['market','orders']),state:z.enum(['connecting','streaming','reconnecting','unavailable'])}),
  z.object({type:z.literal('order')}),
  z.object({type:z.literal('tick'),key:z.string().regex(/^[a-z_]+\|[1-9]\d*$/),price:z.number().finite().positive(),sourceAt:z.number().int().positive()}),
]);

/** Private child IPC, never a network service. No credentials in argv/env/logs. */
export function startKotakSdk(op:'login'|'portfolio'|'stream', data:unknown, receive:(value:unknown)=>void, failed:(code?:KotakSdkErrorCode)=>void) {
  const child=spawn(process.env.KOTAK_SDK_PYTHON ?? resolve(root,'services/kotak-sdk/.venv/bin/python'),[resolve(root,'services/kotak-sdk/bridge.py')],{stdio:['pipe','pipe','pipe'],env:{PATH:process.env.PATH,HOME:process.env.HOME,LANG:process.env.LANG,PYTHONUNBUFFERED:'1',PYTHONDONTWRITEBYTECODE:'1'}});
  let stopped=false, broken=false, buffer='';
  const fail=(code:KotakSdkErrorCode='SDK_UPSTREAM')=>{if(stopped||broken)return;broken=true;child.kill();failed(code);};
  child.stderr.resume(); // Third-party error text may contain broker credentials.
  child.on('error',(error:NodeJS.ErrnoException)=>fail(error.code==='ENOENT'?'SDK_MISSING':'SDK_UPSTREAM'));child.on('exit',()=>{if(!stopped)fail();});
  child.stdin.on('error',()=>fail());
  child.stdout.setEncoding('utf8');
  child.stdout.on('data',(chunk:string)=>{
    if(stopped||broken)return;
    buffer+=chunk;
    if(Buffer.byteLength(buffer)>8_000_000){fail();return;}
    let end:number;
    while((end=buffer.indexOf('\n'))>=0){
      const line=buffer.slice(0,end);buffer=buffer.slice(end+1);
      try{receive(JSON.parse(line));}catch{fail();return;}
    }
  });
  child.stdin.write(JSON.stringify({op,data})+'\n');
  return {send(value:unknown){if(!stopped&&!broken)child.stdin.write(JSON.stringify(value)+'\n');},stop(){stopped=true;child.stdin.end();child.kill();}};
}

export function kotakSdkRequest(op:'login'|'portfolio',data:unknown,launch:typeof startKotakSdk=startKotakSdk):Promise<unknown>{
  return new Promise((resolve,reject)=>{
    let bridge:ReturnType<typeof startKotakSdk>|undefined;
    let settled=false;
    const timer=setTimeout(()=>fail('SDK_TIMEOUT'),30_000);
    function fail(code:KotakSdkErrorCode='SDK_UPSTREAM'){
      if(settled)return;settled=true;clearTimeout(timer);bridge?.stop();reject(new KotakSdkError(code));
    }
    try{
      bridge=launch(op,data,value=>{
        if(settled)return;
        const error=z.object({error:ErrorCodeSchema}).strict().safeParse(value);
        if(error.success){fail(error.data.error);return;}
        const parsed=z.object({result:z.unknown()}).strict().safeParse(value);
        if(!parsed.success || !Object.hasOwn(value as object,'result')){fail('SDK_INVALID_RESPONSE');return;}
        settled=true;clearTimeout(timer);bridge?.stop();resolve(parsed.data.result);
      },fail);
      if(settled)bridge.stop();
    }catch{fail();}
  });
}
