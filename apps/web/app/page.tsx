import { redirect } from "next/navigation";

/**
 * Root route. There is no standalone "home" screen distinct from the
 * product -- Overview (Algo Terminal) is the actual entry point, so
 * this redirects there instead of leaving the original scaffold's
 * placeholder ("Platform shell is running.") as a dead route now that
 * the app has real content.
 */
export default function HomePage() {
  redirect("/app/overview");
}
