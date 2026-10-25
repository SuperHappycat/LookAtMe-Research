import { redirect } from "next/navigation";

// Research app: children are registered by code at /r (no names, emails or provinces).
// The original intake form, components/IntakeClient.tsx, is kept for upstream merges.
export default function IntakePage() {
  redirect("/r");
}
