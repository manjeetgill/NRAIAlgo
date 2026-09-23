import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { kotakSdkRequest, KotakSdkError, type startKotakSdk } from "../../../backend/nodejs/src/broker-auth/kotak-sdk.js";
import * as sdk from "../../../backend/nodejs/src/broker-auth/kotak-sdk.js";
import { kotakDailyLogin } from "../../../backend/nodejs/src/broker-auth/kotak.js";
import { fetchKotakPortfolio } from "../../../backend/nodejs/src/broker-auth/kotak-portfolio.js";

afterEach(()=>vi.useRealTimers());
describe('SDK IPC errors',()=>{
  it.each(['TOTP_LOGIN','MPIN_VERIFY','SDK_MISSING','SDK_TIMEOUT','SDK_UPSTREAM','SDK_INVALID_RESPONSE'] as const)('preserves only allowlisted %s',async code=>{
    const stop=vi.fn();
    const launch:typeof startKotakSdk=(_op,_data,receive)=>{receive({error:code});return{send:vi.fn(),stop};};
    await expect(kotakSdkRequest('login',{},launch)).rejects.toMatchObject({code});
    expect(stop).toHaveBeenCalledOnce();
  });
  it('never exposes arbitrary broker output',async()=>{
    const launch:typeof startKotakSdk=(_op,_data,receive)=>{receive({error:'secret token'});return{send:vi.fn(),stop:vi.fn()};};
    await expect(kotakSdkRequest('login',{},launch)).rejects.toMatchObject({code:'SDK_INVALID_RESPONSE',message:'Kotak SDK returned an invalid response.'});
  });
  it('terminates a hung process on deadline and ignores a late result',async()=>{
    vi.useFakeTimers();const stop=vi.fn();let receive:(value:unknown)=>void=()=>{};
    const promise=kotakSdkRequest('portfolio',{},(_op,_data,callback)=>{receive=callback;return{send:vi.fn(),stop};},8000);
    const assertion=expect(promise).rejects.toMatchObject({code:'SDK_TIMEOUT'});
    await vi.advanceTimersByTimeAsync(7999);expect(stop).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);await assertion;
    receive({result:{}});expect(stop).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
  });
  it('preserves a missing runtime launch failure',async()=>{
    await expect(kotakSdkRequest('login',{},(_op,_data,_receive,failed)=>{
      failed('SDK_MISSING');return{send:vi.fn(),stop:vi.fn()};
    })).rejects.toMatchObject({code:'SDK_MISSING'});
  });
});


describe('production Kotak SDK routing',()=>{
  beforeEach(()=>{ vi.spyOn(sdk, 'kotakSdkRequest'); });
  afterEach(()=>{ vi.restoreAllMocks(); });
  it.each(['TOTP_LOGIN','MPIN_VERIFY'] as const)('maps %s to the correct login stage without leaking SDK details',async code=>{
    vi.mocked(sdk.kotakSdkRequest).mockRejectedValueOnce(new KotakSdkError(code));
    await expect(kotakDailyLogin({accessToken:'secret',mobileNumber:'mobile',ucc:'A',totp:'otp',mpin:'pin'})).rejects.toMatchObject({stage:code});
  });
  it('retains timeout classification instead of treating it as a rejected credential',async()=>{
    vi.mocked(sdk.kotakSdkRequest).mockRejectedValueOnce(new KotakSdkError('SDK_TIMEOUT'));
    await expect(kotakDailyLogin({accessToken:'secret',mobileNumber:'mobile',ucc:'A',totp:'otp',mpin:'pin'})).rejects.toMatchObject({code:'SDK_TIMEOUT',message:expect.stringContaining('timed out')});
  });
  it('routes daily login through Python, validating its returned session',async()=>{
    vi.mocked(sdk.kotakSdkRequest).mockResolvedValueOnce({token:'t',sid:'s',baseUrl:'https://mis.kotaksecurities.com'});
    const input={accessToken:'app',mobileNumber:'mobile',ucc:'A',totp:'otp',mpin:'pin'};
    expect(await kotakDailyLogin(input)).toMatchObject({token:'t',sid:'s'});
    expect(sdk.kotakSdkRequest).toHaveBeenLastCalledWith('login',input);
    vi.mocked(sdk.kotakSdkRequest).mockResolvedValueOnce({token:''});
    await expect(kotakDailyLogin(input)).rejects.toThrow();
  });
  it('normalizes SDK account data without direct HTTP or fabricated margins',async()=>{
    const session={token:'t',sid:'s',baseUrl:'https://mis.kotaksecurities.com'};
    vi.mocked(sdk.kotakSdkRequest).mockResolvedValueOnce({holdings:{data:[]},positions:{data:[]},limits:{Net:'100',MarginUsed:'20',CollateralValue:'80'},quotes:[]});
    const result=await fetchKotakPortfolio(session,'LIVE',new Date(),'A',undefined,8000,'app');
    expect(sdk.kotakSdkRequest).toHaveBeenLastCalledWith('portfolio',{session,accountId:'A',appAccessToken:'app'},undefined,8000);
    expect(result.holdings.availableMarginPaise).toBe(10000);
    expect(result.pnl.netPaise).toBeNull();
    vi.mocked(sdk.kotakSdkRequest).mockRejectedValueOnce(new Error('SDK failed'));
    await expect(fetchKotakPortfolio(session,'LIVE',new Date(),'A',undefined,8000,'app')).rejects.toThrow('SDK failed');
  });
});
