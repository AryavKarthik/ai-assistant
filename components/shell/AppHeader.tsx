import { AppBrand } from "./AppBrand";
import { NotificationBell } from "@/components/notifications/NotificationBell";

interface AppHeaderProps {
  voiceActive: boolean;
  voiceWakeWordMode?: boolean;
  voiceModeLabel?: string;
}

export function AppHeader({
  voiceActive = false,
  voiceWakeWordMode = false,
  voiceModeLabel,
}: AppHeaderProps) {

  return (
    <header className="app-header">
      <div className="flex items-center gap-2">
        <AppBrand />
        <span className="app-pill">
          <span className="app-pill-dot" />
          Online
        </span>
        {voiceActive || voiceWakeWordMode ? (
          <span
            className={`app-pill app-pill-voice${voiceWakeWordMode ? " app-pill-voice-wake" : ""}`}
          >
            <span className="app-pill-dot app-pill-dot-voice" />
            {voiceModeLabel ?? "Voice"}
          </span>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <NotificationBell />
      </div>
    </header>
  );
}
