import { describe, expect, it } from "vitest";
import { credentialVault } from "../../backend/nodejs/src/credential-vault.js";

const testEnv = { CREDENTIAL_VAULT_KEY: "a".repeat(64) } as NodeJS.ProcessEnv;

describe("credentialVault", () => {
  it("round-trips a value through the same context", () => {
    const vault = credentialVault(testEnv);
    const ciphertext = vault.seal("ws-1:zerodha", { apiKey: "abc", apiSecret: "def" });

    expect(vault.open("ws-1:zerodha", ciphertext)).toEqual({ apiKey: "abc", apiSecret: "def" });
  });

  it("fails closed when opened under a different context", () => {
    const vault = credentialVault(testEnv);
    const ciphertext = vault.seal("ws-1:zerodha", { apiKey: "abc" });

    expect(() => vault.open("ws-2:zerodha", ciphertext)).toThrow();
  });

  it("fails closed under a different key", () => {
    const vault = credentialVault(testEnv);
    const ciphertext = vault.seal("ws-1:zerodha", { apiKey: "abc" });
    const otherVault = credentialVault({ CREDENTIAL_VAULT_KEY: "b".repeat(64) } as NodeJS.ProcessEnv);

    expect(() => otherVault.open("ws-1:zerodha", ciphertext)).toThrow();
  });

  it("never stores the plaintext value anywhere in the ciphertext", () => {
    const vault = credentialVault(testEnv);
    const ciphertext = vault.seal("ws-1:kotak", { accessToken: "super-secret-token-value" });

    expect(ciphertext).not.toContain("super-secret-token-value");
  });

  it("rejects a key that isn't 64 hex characters", () => {
    expect(() => credentialVault({ CREDENTIAL_VAULT_KEY: "too-short" } as NodeJS.ProcessEnv)).toThrow();
  });
});
