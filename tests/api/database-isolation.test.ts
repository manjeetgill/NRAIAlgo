import { describe, expect, it } from "vitest";
import pg from "pg";
import { openDatabaseStore } from "../../apps/api/src/database.js";
import { readLocalPostgresConfiguration } from "../../apps/api/src/local-database.js";

describe("application database isolation", () => {
  it("blocks arbitrary pools and clients before making a connection", () => {
    const connectionString = "postgresql://app:example@production.invalid/app";
    expect(() => new pg.Pool({ connectionString })).toThrow("disposable database");
    expect(() => new pg.Client({ connectionString })).toThrow("disposable database");
    expect(() => openDatabaseStore(connectionString)).toThrow("disposable database");
  });
  it("blocks reading the application's local database credentials", () => {
    expect(() => readLocalPostgresConfiguration()).toThrow("cannot read application database");
  });
});
