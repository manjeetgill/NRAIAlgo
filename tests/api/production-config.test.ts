import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { databaseTlsOptions, loadSecretFiles, validateProductionConfig } from "../../backend/nodejs/src/production-config.js";
import { SCHEMA_VERSION, runDatabaseMigrations, verifyRuntimeDatabase, type Query, type Store } from "../../backend/nodejs/src/database/database.js";
import { readinessRoutes } from "../../backend/nodejs/src/routes/health.js";

const folders:string[]=[];
afterEach(()=>{for(const folder of folders.splice(0))rmSync(folder,{recursive:true,force:true});});
function fixture(value:string){const folder=mkdtempSync(join(tmpdir(),"nraialgo-config-test-"));folders.push(folder);const file=join(folder,"secret");writeFileSync(file,value,{mode:0o600});return file;}
const valid=():NodeJS.ProcessEnv=>({NODE_ENV:"production",DATABASE_URL:"postgresql://nraialgo_app:example@db/app",CREDENTIAL_VAULT_KEY:"a".repeat(64),FRONTEND_ORIGIN:"https://algo.example.com",API_PUBLIC_ORIGIN:"https://algo.example.com",TRUST_PROXY:"1"});
function fakeStore(version:number|null=SCHEMA_VERSION,safe=true):Store{return {async transaction(fn){return fn((async(sql:string)=>sql.includes("MAX(version)")?[{max:version}]:[{safe}]) as Query);},async close(){}};}

describe("production configuration and deployment gates",()=>{
  it("loads mounted secrets but rejects conflicting or empty values",()=>{
    const env:NodeJS.ProcessEnv={DATABASE_URL_FILE:fixture("connection\n")};loadSecretFiles(env);expect(env.DATABASE_URL).toBe("connection");
    expect(()=>loadSecretFiles(env)).toThrow("not both");
    expect(()=>loadSecretFiles({CREDENTIAL_VAULT_KEY_FILE:fixture(" \n")})).toThrow("empty");
  });
  it("accepts restricted same-origin production configuration",()=>{expect(()=>validateProductionConfig(valid())).not.toThrow();});
  it.each([
    {DATABASE_ADMIN_URL:"postgresql://admin:secret@db/app"},
    {DATABASE_ADMIN_URL_FILE:"/admin"}, {APP_DATABASE_PASSWORD:"secret"},
    {DATABASE_URL:"postgresql://admin:secret@db/app"}, {CREDENTIAL_VAULT_KEY:"short"},
    {FRONTEND_ORIGIN:"http://algo.example.com"}, {API_PUBLIC_ORIGIN:"https://other.example.com"},
    {FRONTEND_ORIGIN:"https://algo.example.com/path"}, {TRUST_PROXY:"true"},
  ])("rejects unsafe configuration %j",change=>{expect(()=>validateProductionConfig({...valid(),...change})).toThrow();});
  it("never puts invalid connection strings into validation errors",()=>{
    try{validateProductionConfig({...valid(),DATABASE_URL:"sensitive-invalid-value"});throw new Error("expected failure");}
    catch(error){expect(String(error)).not.toContain("sensitive-invalid-value");}
  });
  it("requires verified TLS and strips connection-string SSL overrides",()=>{
    const env={NODE_ENV:"production",DATABASE_CA_FILE:fixture("test-ca")};
    const options=databaseTlsOptions("postgresql://u:p@db/app?sslmode=verify-full&sslrootcert=bad&ssl=false",env);
    expect(options.ssl).toEqual({ca:"test-ca",rejectUnauthorized:true});expect(options.connectionString).not.toContain("ssl");
    expect(()=>databaseTlsOptions("postgresql://u:p@db/app?sslmode=require",env)).toThrow("verify-full");
    expect(()=>databaseTlsOptions("postgresql://u:p@db/app",{NODE_ENV:"production"})).toThrow("DATABASE_CA_FILE");
  });
  it("rejects incompatible schemas and elevated runtime roles",async()=>{
    await expect(verifyRuntimeDatabase(fakeStore())).resolves.toBeUndefined();
    await expect(verifyRuntimeDatabase(fakeStore(0))).rejects.toThrow("schema");
    await expect(verifyRuntimeDatabase(fakeStore(SCHEMA_VERSION,false))).rejects.toThrow("overprivileged");
  });
  it.each([null,0,SCHEMA_VERSION-1,SCHEMA_VERSION,SCHEMA_VERSION+1])("readiness verifies schema %s",async version=>{
    const app=Fastify();app.register(readinessRoutes(fakeStore(version)));
    try{const response=await app.inject("/v1/readiness");expect(response.statusCode).toBe(version===SCHEMA_VERSION?200:503);}finally{await app.close();}
  });
  it("escapes role-password literals and grants only runtime table access",async()=>{
    const queries:string[]=[];
    const store:Store={async transaction(fn){return fn((async(sql:string)=>{queries.push(sql);return [{version:1,rolname:"nraialgo_app"}];}) as Query);},async close(){}};
    await runDatabaseMigrations(store,{runtimePassword:"has'quote\\and-slash"});
    expect(queries).toContain("SET LOCAL standard_conforming_strings = on");
    expect(queries).toContain("ALTER ROLE nraialgo_app PASSWORD 'has''quote\\and-slash'");
    expect(queries).toContain("REVOKE ALL ON schema_migrations FROM nraialgo_app");
  });
});
