"use client";

import {
  IconBell,
  IconBrain,
  IconLogout,
  IconMessage,
  IconPlugConnected,
  IconSettings,
} from "@tabler/icons-react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { FloatingDock } from "@/components/ui/floating-dock";

const iconClass = "h-full w-full text-neutral-400";
const dockClassName =
  "rounded-[24px] border border-[rgb(255_255_255/8%)] bg-[rgb(16_16_16/88%)] px-4 pb-2.5 pt-2 shadow-[0_12px_40px_rgb(0_0_0/45%),inset_0_1px_0_rgb(255_255_255/6%)] backdrop-blur-xl";

export function AppDock() {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createBrowserSupabaseClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const items = [
    { title: "Chat", icon: <IconMessage className={iconClass} />, href: "/" },
    {
      title: "Reminders",
      icon: <IconBell className={iconClass} />,
      href: "/reminders",
    },
    { title: "Memory", icon: <IconBrain className={iconClass} />, href: "/memory" },
    {
      title: "Connections",
      icon: <IconPlugConnected className={iconClass} />,
      href: "/connections",
    },
    {
      title: "Settings",
      icon: <IconSettings className={iconClass} />,
      href: "/settings",
    },
    { title: "Sign out", icon: <IconLogout className={iconClass} />, href: "/login" },
  ];

  return (
    <div className="app-dock-host">
      <div
        className="pointer-events-auto"
        onClickCapture={(e) => {
          const anchor = (e.target as HTMLElement).closest("a");
          if (anchor?.getAttribute("href") === "/login") {
            e.preventDefault();
            void handleSignOut();
          }
        }}
      >
        <FloatingDock
          items={items}
          desktopClassName={dockClassName}
          mobileClassName={dockClassName}
        />
      </div>
    </div>
  );
}
