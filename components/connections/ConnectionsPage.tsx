"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { fetchJson } from "@/lib/client/fetch";
import type { GoogleConnectionStatus } from "@/lib/google/connection-types";
import { Badge, Button, Card, Notice } from "@/components/ui/primitives";
import { CircularLoader } from "@/components/ui/loader";
import { PageShell } from "@/components/shell/PageShell";

function formatConnectedAt(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString();
}

function serviceLabel(service: string): string {
  if (service === "calendar") return "Google Calendar";
  if (service === "gmail") return "Gmail";
  if (service === "youtube") return "YouTube";
  return service;
}

function formatOAuthError(error: string): string {
  const hints: Record<string, string> = {
    callback_failed:
      "Connection failed. Try again and check the dev server logs if it keeps failing.",
    no_refresh_token:
      "Google did not return a refresh token. Revoke this app at myaccount.google.com/permissions, then reconnect and accept all permissions.",
    invalid_state:
      "Your session expired or cookies were blocked. Sign in again and retry the connect flow.",
    missing_code:
      "OAuth was interrupted. Complete the Google consent screen without closing the tab.",
  };

  return hints[error] ?? `Connect failed: ${error.replace(/_/g, " ")}`;
}

export function ConnectionsPage() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<GoogleConnectionStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busyService, setBusyService] = useState<string | null>(null);
  const [actionBanner, setActionBanner] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const urlBanner = useMemo(() => {
    const connected = searchParams.get("connected");
    const error = searchParams.get("error");
    if (connected) {
      return {
        type: "success" as const,
        message: `${serviceLabel(connected)} connected successfully.`,
      };
    }
    if (error) {
      return {
        type: "error" as const,
        message: formatOAuthError(error),
      };
    }
    return null;
  }, [searchParams]);

  const banner = actionBanner ?? urlBanner;
  const youtubeMissingScope =
    status?.youtube.connected === true && status.youtube.canUse === false;
  const gmailMissingSendScope =
    status?.gmail.connected === true && status.gmail.canSend === false;

  const loadStatus = useCallback(async () => {
    setActionBanner(null);
    const data = await fetchJson<GoogleConnectionStatus>("/api/google/status");
    setStatus(data);
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await loadStatus();
      } catch (err) {
        if (!cancelled) {
          setActionBanner({
            type: "error",
            message:
              err instanceof Error
                ? err.message
                : "Could not load connection status. Retry to continue.",
          });
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadStatus]);

  async function handleDisconnect(service: "calendar" | "gmail" | "youtube") {
    if (
      !confirm(
        `Disconnect ${serviceLabel(service)}? The assistant will lose access.`,
      )
    ) {
      return;
    }

    setBusyService(service);
    try {
      await fetchJson(`/api/google/${service}/disconnect`, { method: "DELETE" });
      await loadStatus();
      setActionBanner({
        type: "success",
        message: `${serviceLabel(service)} disconnected.`,
      });
    } catch (err) {
      setActionBanner({
        type: "error",
        message:
          err instanceof Error ? err.message : "Could not disconnect service.",
      });
    } finally {
      setBusyService(null);
    }
  }

  async function handleRefreshTaste() {
    setBusyService("youtube-refresh");
    try {
      await fetchJson("/api/google/youtube/refresh-taste", { method: "POST" });
      setActionBanner({
        type: "success",
        message: "YouTube taste profile refreshed.",
      });
    } catch (err) {
      setActionBanner({
        type: "error",
        message:
          err instanceof Error ? err.message : "Could not refresh taste profile.",
      });
    } finally {
      setBusyService(null);
    }
  }

  function renderServiceCard(
    service: "calendar" | "gmail" | "youtube",
    title: string,
    description: string,
    extra?: React.ReactNode,
  ) {
    const serviceStatus = status?.[service];
    const isBusy = busyService === service;

    return (
      <section
        key={service}
        className="ui-surface"
      >
        <Card className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-medium">{title}</h2>
            <p className="mt-1 text-sm ui-text-secondary">
              {description}
            </p>
            {isLoading ? (
              <div className="mt-3">
                <CircularLoader size="sm" className="border-[#666]" />
              </div>
            ) : serviceStatus?.connected ? (
              <p className="mt-3 text-sm">
                <Badge
                  tone={
                    (service === "youtube" && youtubeMissingScope) ||
                    (service === "gmail" && gmailMissingSendScope)
                      ? "warn"
                      : "success"
                  }
                  className="mr-2 align-middle"
                >
                  {service === "youtube" && youtubeMissingScope
                    ? "Connected (missing permission)"
                    : service === "gmail" && gmailMissingSendScope
                      ? "Connected (send not enabled)"
                      : "Connected"}
                </Badge>
                {serviceStatus.email ? ` as ${serviceStatus.email}` : ""}
                {serviceStatus.connectedAt
                  ? ` · since ${formatConnectedAt(serviceStatus.connectedAt)}`
                  : ""}
              </p>
            ) : (
              <p className="mt-3 text-sm ui-muted">Not connected</p>
            )}
            {extra}
          </div>
          <div className="flex shrink-0 flex-col gap-2">
            {serviceStatus?.connected ? (
              <Button
                type="button"
                onClick={() => handleDisconnect(service)}
                disabled={isBusy}
                variant="secondary"
              >
                {isBusy ? "Disconnecting…" : "Disconnect"}
              </Button>
            ) : (
              <a
                href={`/api/google/${service}/connect`}
                className="ui-button ui-button-primary inline-block px-4 py-2 text-center text-sm font-medium"
              >
                Connect {title.split(" ")[0]}
              </a>
            )}
            {service === "youtube" && serviceStatus?.connected && youtubeMissingScope ? (
              <a
                href="/api/google/youtube/connect"
                className="ui-button ui-button-secondary inline-block px-4 py-2 text-center text-sm font-medium"
              >
                Re-consent YouTube
              </a>
            ) : null}
            {service === "gmail" && serviceStatus?.connected && gmailMissingSendScope ? (
              <a
                href="/api/google/gmail/connect"
                className="ui-button ui-button-secondary inline-block px-4 py-2 text-center text-sm font-medium"
              >
                Reconnect for sending
              </a>
            ) : null}
          </div>
        </div>
        </Card>
      </section>
    );
  }

  return (
    <PageShell
      title="Connections"
      subtitle="Connected sources your assistant can use in planning and answers."
    >

      {banner && (
        <Notice
          tone={banner.type === "success" ? "success" : "error"}
          actions={
            banner.type === "error" ? (
              <Button type="button" variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => void loadStatus()}>
                Retry
              </Button>
            ) : undefined
          }
        >
          {banner.message}
        </Notice>
      )}

      <div className="space-y-4">
        {renderServiceCard(
          "calendar",
          "Google Calendar",
          "Read and manage events on your primary calendar from chat.",
        )}
        {renderServiceCard(
          "gmail",
          "Gmail",
          "Search, summarize, draft, and send email from chat. Sending requires your confirmation via the Send button on each draft.",
        )}
        {renderServiceCard(
          "youtube",
          "YouTube",
          "Taste-aware recommendations from your subscriptions and likes.",
          status?.youtube.connected ? (
            <Button
              type="button"
              onClick={handleRefreshTaste}
              disabled={busyService === "youtube-refresh"}
              variant="ghost"
              className="mt-3 text-sm underline"
            >
              {busyService === "youtube-refresh"
                ? "Refreshing taste…"
                : "Refresh taste profile"}
            </Button>
          ) : null,
        )}
      </div>
    </PageShell>
  );
}
