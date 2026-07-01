import { useEffect, useState } from "react";
import { nova } from "../lib/ipc";
import type { GoogleConnectionStatus, GoogleService } from "@shared/types";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";

const SERVICES: { key: GoogleService; label: string; description: string }[] = [
  { key: "calendar", label: "Google Calendar", description: "Access your schedule and events" },
  { key: "gmail", label: "Gmail", description: "Read and summarize your emails" },
  { key: "youtube", label: "YouTube", description: "Personalize recommendations based on taste" },
];

export function ConnectionsPage() {
  const [status, setStatus] = useState<GoogleConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<GoogleService | null>(null);

  async function load() {
    setLoading(true);
    try {
      const s = await nova().connectionsStatus();
      setStatus(s as GoogleConnectionStatus);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // Refresh when OAuth callback fires
    const unsub = nova().onConnectionsCallback(() => void load());
    return unsub;
  }, []);

  async function connect(service: GoogleService) {
    setPending(service);
    try {
      await nova().connectionsConnect({ service });
    } finally {
      setPending(null);
    }
  }

  async function disconnect(service: GoogleService) {
    setPending(service);
    try {
      await nova().connectionsDisconnect({ service });
      await load();
    } finally {
      setPending(null);
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-full text-sm text-[--nova-text-secondary]">Loading…</div>;
  }

  return (
    <div className="max-w-xl mx-auto py-8 space-y-4">
      <h1 className="text-lg font-semibold text-[--nova-text]">Connections</h1>

      <p className="text-sm text-[--nova-text-secondary]">
        Connect your Google services so Nova can access your calendar, email, and YouTube taste profile.
      </p>

      <div className="rounded-xl border border-amber-500/20 bg-amber-500/8 p-3 text-xs text-amber-300">
        <strong>One-time setup required:</strong> Add <code>nova://connections-callback</code> as an
        authorized redirect URI in your Google OAuth app at{" "}
        <span className="underline cursor-pointer" onClick={() => void nova().connectionsConnect({ service: "" })}>
          console.cloud.google.com
        </span>
        .
      </div>

      <div className="space-y-3">
        {SERVICES.map((svc) => {
          const svcStatus = status?.[svc.key];
          const isConnected = svcStatus?.connected ?? false;
          const isPending = pending === svc.key;

          return (
            <Card key={svc.key} className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium text-[--nova-text]">{svc.label}</div>
                <div className="text-xs text-[--nova-text-secondary] mt-0.5">{svc.description}</div>
                {isConnected && (
                  <div className="text-xs text-green-400 mt-1">Connected</div>
                )}
              </div>
              {isConnected ? (
                <Button
                  size="sm"
                  variant="danger"
                  disabled={isPending}
                  onClick={() => void disconnect(svc.key)}
                >
                  {isPending ? "…" : "Disconnect"}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="primary"
                  disabled={isPending}
                  onClick={() => void connect(svc.key)}
                >
                  {isPending ? "Opening…" : "Connect"}
                </Button>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
