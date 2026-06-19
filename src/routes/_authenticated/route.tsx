import { createFileRoute, Outlet, redirect, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { Activity, LayoutDashboard, BellRing, Settings, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AuthenticatedShell,
});

function AuthenticatedShell() {
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const nav = [
    { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/alerts", label: "Alerts", icon: BellRing },
    { to: "/settings", label: "Settings", icon: Settings },
  ] as const;

  return (
    <div className="min-h-screen bg-background text-foreground flex">
      <aside className="hidden md:flex w-60 flex-col border-r border-border/60 bg-sidebar text-sidebar-foreground">
        <div className="px-5 py-5 border-b border-sidebar-border flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          <div>
            <div className="font-mono text-sm font-bold tracking-tight">ELLIOTT × ICT</div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Pro Terminal</div>
          </div>
        </div>
        <nav className="flex-1 px-2 py-4 space-y-1">
          {nav.map((item) => {
            const active = path === item.to || path.startsWith(item.to + "/");
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent text-primary"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-sidebar-border space-y-2">
          <div className="px-2 text-xs text-muted-foreground truncate">{email}</div>
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={signOut}>
            <LogOut className="h-4 w-4 mr-2" />
            Sign out
          </Button>
        </div>
      </aside>
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar */}
        <header className="md:hidden border-b border-border/60 bg-card flex items-center justify-between px-4 py-3">
          <Link to="/dashboard" className="flex items-center gap-2 text-primary">
            <Activity className="h-5 w-5" />
            <span className="font-mono text-sm font-bold">ELLIOTT × ICT</span>
          </Link>
          <Button variant="ghost" size="icon" onClick={signOut}>
            <LogOut className="h-4 w-4" />
          </Button>
        </header>
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
        <nav className="md:hidden border-t border-border/60 bg-card grid grid-cols-3">
          {[
            { to: "/dashboard", label: "Dash", icon: LayoutDashboard },
            { to: "/alerts", label: "Alerts", icon: BellRing },
            { to: "/settings", label: "Settings", icon: Settings },
          ].map((item) => {
            const active = path.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex flex-col items-center gap-1 py-2 text-xs",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
      <Toaster theme="dark" position="top-right" />
    </div>
  );
}