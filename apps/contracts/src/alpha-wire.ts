import { z } from "zod";

export const alphaWireItemSchema = z.object({
  id: z.string(), title: z.string(), url: z.string().url(),
  source: z.string(), category: z.enum(["Announcements", "News", "Macro", "Regulatory", "Social"]),
  publisher: z.string().optional(), symbols: z.array(z.string()).optional(),
  sentiment: z.string().optional(),
  publishedAt: z.string().nullable(), receivedAt: z.string(),
});
export const alphaWireSnapshotSchema = z.object({
  items: z.array(alphaWireItemSchema).max(200),
  source: z.object({
    status: z.enum(["waiting", "healthy", "unavailable", "disabled"]),
    lastCheckedAt: z.string().nullable(), lastSuccessAt: z.string().nullable(),
    pollIntervalSeconds: z.literal(300),
  }),
  sources: z.array(z.object({
    id: z.string(), name: z.string(), category: z.string(),
    status: z.enum(["waiting", "healthy", "unavailable", "disabled", "key_required", "access_denied", "rate_limited"]),
    lastCheckedAt: z.string().nullable(), lastSuccessAt: z.string().nullable(),
    pollIntervalSeconds: z.number(),
  })).optional(),
});
export type AlphaWireItem = z.infer<typeof alphaWireItemSchema>;
export type AlphaWireSnapshot = z.infer<typeof alphaWireSnapshotSchema>;

/** Links only: the backend never fetches article URLs. Reject local/network URLs. */
export function safeNewsUrl(value: string): string | null {
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.username || u.password || u.port || !u.hostname.includes(".") ||
      /(^[\d.]+$|:|(?:^|\.)(?:localhost|local|internal|test|invalid)$)/i.test(u.hostname)) return null;
    u.hash = "";
    for (const key of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(key)) u.searchParams.delete(key);
    return u.href;
  } catch { return null; }
}
