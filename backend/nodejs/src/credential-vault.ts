/** Encrypted-at-rest storage for broker app credentials (API keys/secrets).
 * AES-256-GCM with a fresh IV per record; the AAD binds ciphertext to its
 * owning workspace/provider so it can never be decrypted under a different
 * context, even with the same key. Adapted from AlgoTrade's proven
 * credentialVault (backend/security.ts), scoped down for NRAIAlgo: no user
 * accounts exist yet, so context is workspace+provider rather than user+provider.
 */
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const projectRoot = resolve(import.meta.dirname, "../../..");

/** Load the production key from CREDENTIAL_VAULT_KEY, or create a restricted
 * local-dev key without ever overwriting an existing one. */
export function credentialVault(env: NodeJS.ProcessEnv = process.env) {
  let hex = env.CREDENTIAL_VAULT_KEY;
  if (!hex) {
    if (env.NODE_ENV === "production") {
      throw new Error("CREDENTIAL_VAULT_KEY must be 64 random hex characters.");
    }
    const directory = resolve(projectRoot, ".runtime");
    const path = resolve(directory, "credential-vault.key");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (lstatSync(directory).isSymbolicLink()) {
      throw new Error("Local runtime directory must not be a symlink.");
    }
    chmodSync(directory, 0o700);
    try {
      if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) {
        throw new Error("Local credential vault key must be a regular file.");
      }
      chmodSync(path, 0o600);
      hex = readFileSync(path, "utf8").trim();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      hex = randomBytes(32).toString("hex");
      try {
        writeFileSync(path, hex, { flag: "wx", mode: 0o600, flush: true });
      } catch (writeError) {
        if ((writeError as NodeJS.ErrnoException).code !== "EEXIST") {
          throw writeError;
        }
        chmodSync(path, 0o600);
        hex = readFileSync(path, "utf8").trim();
      }
    }
  }
  if (!/^[a-f0-9]{64}$/i.test(hex)) {
    throw new Error("CREDENTIAL_VAULT_KEY must be 64 random hex characters.");
  }
  const key = Buffer.from(hex, "hex");
  return {
    /** Serialize and authenticate a secret, binding its ciphertext to its context. */
    seal(context: string, value: unknown): string {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(Buffer.from(`nraialgo:credential:v1:${context}`));
      const encrypted = Buffer.concat([
        cipher.update(JSON.stringify(value), "utf8"),
        cipher.final(),
      ]);
      return [
        "v1",
        iv.toString("base64"),
        cipher.getAuthTag().toString("base64"),
        encrypted.toString("base64"),
      ].join(".");
    },
    /** Authenticate before parsing; a changed key, record or context fails closed. */
    open(context: string, text: string): unknown {
      const [version, iv, tag, encrypted] = text.split(".");
      if (version !== "v1" || !iv || !tag || !encrypted) {
        throw new Error("Unsupported credential format.");
      }
      const cipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
      cipher.setAAD(Buffer.from(`nraialgo:credential:v1:${context}`));
      cipher.setAuthTag(Buffer.from(tag, "base64"));
      return JSON.parse(
        Buffer.concat([
          cipher.update(Buffer.from(encrypted, "base64")),
          cipher.final(),
        ]).toString("utf8"),
      );
    },
  };
}
