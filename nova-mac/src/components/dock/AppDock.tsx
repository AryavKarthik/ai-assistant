import {
  IconMicrophone,
  IconBell,
  IconBrain,
  IconPlugConnected,
  IconSettings,
  IconLogout,
} from "@tabler/icons-react";
import { FloatingDock, type DockItem } from "../ui/floating-dock";
import { nova } from "../../lib/ipc";

type Tab = "reminders" | "memory" | "connections" | "settings";

interface AppDockProps {
  onTabChange: (tab: Tab) => void;
}

export function AppDock({ onTabChange }: AppDockProps) {
  const items: DockItem[] = [
    { title: "Orb", icon: <IconMicrophone size={20} />, onClick: () => nova().appClose() },
    { title: "Reminders", icon: <IconBell size={20} />, onClick: () => onTabChange("reminders") },
    { title: "Memory", icon: <IconBrain size={20} />, onClick: () => onTabChange("memory") },
    { title: "Connections", icon: <IconPlugConnected size={20} />, onClick: () => onTabChange("connections") },
    { title: "Settings", icon: <IconSettings size={20} />, onClick: () => onTabChange("settings") },
    { title: "Sign out", icon: <IconLogout size={20} />, onClick: () => void nova().authSignOut() },
  ];

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
      <FloatingDock items={items} />
    </div>
  );
}
