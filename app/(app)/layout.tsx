import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getCurrentUser } from "@/lib/auth/session";
import { toClientContext } from "@/lib/auth/client-context";
import { AppProviders } from "@/components/providers/app-context";
import { AppShell } from "@/components/shell/app-shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) {
    const path = headers().get("x-pathname") ?? "/dashboard";
    redirect(`/api/auth/session-expired?next=${encodeURIComponent(path)}`);
  }
  if (!user.onboardedAt) redirect("/onboarding");
  const ctx = toClientContext(user);
  return (
    <AppProviders user={ctx.user} preferences={ctx.preferences}>
      <AppShell>{children}</AppShell>
    </AppProviders>
  );
}
