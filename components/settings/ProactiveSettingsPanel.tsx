"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchJson } from "@/lib/client/fetch";
import { rememberClientTimeZone } from "@/lib/client/timezone";
import { subscribeToPushNotifications } from "@/lib/client/push";
import { isPushApiSupported } from "@/lib/client/local-notifications";
import type { UserPreferences, ProactiveTier } from "@/lib/proactive/types";
import { Button, Card, Notice, Select } from "@/components/ui/primitives";
import { PageShell } from "@/components/shell/PageShell";
import { LoadingScreen } from "@/components/shell/LoadingScreen";

export function ProactiveSettingsPanel() {
  const [prefs, setPrefs] = useState<UserPreferences | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await fetchJson<{ preferences: UserPreferences }>(
        "/api/settings/proactive",
      );
      setPrefs(data.preferences);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load settings");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(patch: Partial<UserPreferences>) {
    if (!prefs) return;
    setIsSaving(true);
    setMessage(null);
    setError(null);
    try {
      const data = await fetchJson<{ preferences: UserPreferences }>(
        "/api/settings/proactive",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...patch,
            clientTimeZone: rememberClientTimeZone(),
          }),
        },
      );
      setPrefs(data.preferences);
      setMessage("Settings saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setIsSaving(false);
    }
  }

  async function enablePush() {
    if (!isPushApiSupported()) {
      setError("Push notifications are not supported in this browser.");
      return;
    }
    try {
      await subscribeToPushNotifications();
      setMessage("Push notifications enabled.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not enable push");
    }
  }

  if (isLoading) {
    return <LoadingScreen fullPage />;
  }

  if (!prefs) {
    return (
      <PageShell title="Settings" subtitle="Proactive assistant">
        <Notice tone="error">{error ?? "Could not load settings"}</Notice>
      </PageShell>
    );
  }

  const briefTimeValue = prefs.brief_time_local.slice(0, 5);
  const quietStart = prefs.quiet_hours_start.slice(0, 5);
  const quietEnd = prefs.quiet_hours_end.slice(0, 5);

  return (
    <PageShell
      title="Settings"
      subtitle="Control when your assistant reaches out. Everything is off by default."
    >
      <div className="mx-auto flex max-w-lg flex-col gap-4">
        {message ? <Notice tone="success">{message}</Notice> : null}
        {error ? <Notice tone="error">{error}</Notice> : null}

        <Card className="flex flex-col gap-4 p-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[#8b9099]">Proactive mode</span>
            <Select
              value={prefs.proactive_tier}
              onChange={(e) =>
                void save({
                  proactive_tier: e.target.value as ProactiveTier,
                })
              }
              disabled={isSaving}
            >
              <option value="off">Off</option>
              <option value="reminders_only">Reminders only</option>
              <option value="full">Full (brief + nudges)</option>
            </Select>
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={prefs.brief_enabled}
              disabled={isSaving || prefs.proactive_tier !== "full"}
              onChange={(e) => void save({ brief_enabled: e.target.checked })}
            />
            Daily morning brief
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[#8b9099]">Brief time (local)</span>
            <input
              type="time"
              className="rounded-lg border border-[rgb(255_255_255/8%)] bg-[#080808] px-3 py-2"
              value={briefTimeValue}
              disabled={isSaving || !prefs.brief_enabled}
              onChange={(e) =>
                void save({ brief_time_local: `${e.target.value}:00` })
              }
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[#8b9099]">Timezone</span>
            <input
              type="text"
              className="rounded-lg border border-[rgb(255_255_255/8%)] bg-[#080808] px-3 py-2"
              value={prefs.timezone}
              disabled={isSaving}
              onChange={(e) => void save({ timezone: e.target.value })}
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-[#8b9099]">Quiet hours start</span>
              <input
                type="time"
                className="rounded-lg border border-[rgb(255_255_255/8%)] bg-[#080808] px-3 py-2"
                value={quietStart}
                disabled={isSaving}
                onChange={(e) =>
                  void save({ quiet_hours_start: `${e.target.value}:00` })
                }
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-[#8b9099]">Quiet hours end</span>
              <input
                type="time"
                className="rounded-lg border border-[rgb(255_255_255/8%)] bg-[#080808] px-3 py-2"
                value={quietEnd}
                disabled={isSaving}
                onChange={(e) =>
                  void save({ quiet_hours_end: `${e.target.value}:00` })
                }
              />
            </label>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={prefs.push_proactive_enabled}
              disabled={isSaving}
              onChange={(e) =>
                void save({ push_proactive_enabled: e.target.checked })
              }
            />
            Send proactive alerts via push
          </label>

          <Button type="button" variant="secondary" onClick={() => void enablePush()}>
            Enable browser push
          </Button>
        </Card>
      </div>
    </PageShell>
  );
}
