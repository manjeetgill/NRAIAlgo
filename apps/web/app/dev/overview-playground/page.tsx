import { notFound } from "next/navigation";
import { OverviewPlaygroundClient } from "./overview-playground-client";

/**
 * Server-enforced production guard: this route must never actually ship.
 * A "use client" component's own `"None of this ships to production"`
 * banner text is not itself a guarantee -- Next.js still builds and
 * serves the route unless something says otherwise. notFound() here runs
 * server-side during this route's render, so a production deployment
 * returns a real 404 for /dev/overview-playground regardless of what the
 * client bundle contains.
 */
export default function OverviewPlaygroundPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }
  return <OverviewPlaygroundClient />;
}
