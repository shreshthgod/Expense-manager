import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { toClientContext } from "@/lib/auth/client-context";
import { AppProviders } from "@/components/providers/app-context";

export const dynamic = "force-dynamic";

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/session-expired?next=/onboarding");
  const ctx = toClientContext(user);
  return (
    <AppProviders user={ctx.user} preferences={ctx.preferences}>
      <div id="app-root" className="min-h-dvh bg-background">{children}</div>
    </AppProviders>
  );
}
