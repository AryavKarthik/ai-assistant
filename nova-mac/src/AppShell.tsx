import { useEffect, useState } from "react";
import { nova } from "./lib/ipc";
import type { AuthState } from "@shared/types";
import { AppDock } from "./components/dock/AppDock";
import { PlaceholderPage } from "./pages/PlaceholderPage";
import { SettingsPage } from "./pages/SettingsPage";

type Tab = "reminders" | "memory" | "connections" | "settings";

function AppContent() {
  const [tab, setTab] = useState<Tab>("settings");

  return (
    <div
      className="flex flex-col"
      style={{ height: "100vh", background: "var(--nova-bg)", color: "var(--nova-text)" }}
    >
      {/* Traffic lights inset area */}
      <div style={{ height: 28, WebkitAppRegion: "drag" } as React.CSSProperties} />

      {/* Main content */}
      <div className="flex-1 overflow-auto px-6 pb-28">
        {tab === "reminders" && <PlaceholderPage title="Reminders" />}
        {tab === "memory" && <PlaceholderPage title="Memory" />}
        {tab === "connections" && <PlaceholderPage title="Connections" />}
        {tab === "settings" && <SettingsPage />}
      </div>

      <AppDock onTabChange={setTab} />
    </div>
  );
}

export function AppShell() {
  const [auth, setAuth] = useState<AuthState>({ signedIn: false, email: null });

  useEffect(() => {
    nova().authStatus().then(setAuth).catch(() => {});
    const unsub = nova().onAuthChanged(setAuth);
    return unsub;
  }, []);

  if (!auth.signedIn) {
    return (
      <div className="flex items-center justify-center h-screen text-sm text-[--nova-text-secondary]">
        Not signed in
      </div>
    );
  }

  return <AppContent />;
}
