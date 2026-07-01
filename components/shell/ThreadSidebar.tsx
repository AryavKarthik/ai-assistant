"use client";

import { useEffect, useState } from "react";
import {
  IconChevronLeft,
  IconChevronRight,
  IconMenu2,
  IconMessage,
  IconPlus,
  IconX,
} from "@tabler/icons-react";
import type { ThreadItem } from "@/lib/chat/types";
import { PulseDotLoader } from "@/components/ui/loader";
import { appIconClass } from "./icons";

interface ThreadSidebarProps {
  threads: ThreadItem[];
  activeThreadId: string | null;
  isLoading: boolean;
  mobileOpen: boolean;
  onMobileClose: () => void;
  onSelect: (threadId: string) => void;
  onDelete: (threadId: string, title: string) => void;
  onNewChat: (section: "main" | "side") => void;
}

function formatThreadTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) {
    return date.toLocaleDateString([], { weekday: "short" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function ThreadSidebar({
  threads,
  activeThreadId,
  isLoading,
  mobileOpen,
  onMobileClose,
  onSelect,
  onDelete,
  onNewChat,
}: ThreadSidebarProps) {
  const [desktopCompact, setDesktopCompact] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [query, setQuery] = useState("");
  const showCompact = desktopCompact && !railOpen && !mobileOpen;

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1025px)");
    const update = () => setDesktopCompact(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  function handleSelect(threadId: string) {
    onSelect(threadId);
    onMobileClose();
  }

  const normalizedQuery = query.trim().toLowerCase();
  const filteredThreads = threads.filter((thread) =>
    !normalizedQuery || thread.title.toLowerCase().includes(normalizedQuery),
  );
  const mainThreads = filteredThreads.filter((thread) => thread.section !== "side");
  const sideThreads = filteredThreads.filter((thread) => thread.section === "side");

  function renderThreadList(items: ThreadItem[]) {
    return items.map((thread) => {
      const isActive = thread.id === activeThreadId;
      return (
        <div key={thread.id} className="app-sidebar-item-wrap">
          <button
            type="button"
            className={`app-sidebar-item${isActive ? " is-active" : ""}`}
            onClick={() => handleSelect(thread.id)}
            title={showCompact ? thread.title : undefined}
          >
            <span className="app-sidebar-item-icon" aria-hidden>
              <IconMessage className={appIconClass} />
            </span>
            {!showCompact ? (
              <span className="app-sidebar-item-body">
                <span className="app-sidebar-item-row">
                  <span className="app-sidebar-item-title">{thread.title}</span>
                  <span className="app-sidebar-item-time">
                    {formatThreadTime(thread.updatedAt)}
                  </span>
                </span>
                <span className="app-sidebar-item-preview">
                  {thread.isActive ? "Current conversation" : "Open conversation"}
                </span>
              </span>
            ) : null}
          </button>
          {!showCompact ? (
            <button
              type="button"
              className={`app-sidebar-item-delete${isActive ? " is-visible" : ""}`}
              aria-label={`Delete ${thread.title}`}
              title="Delete conversation"
              onClick={(e) => {
                e.stopPropagation();
                void onDelete(thread.id, thread.title);
              }}
            >
              <IconX className="h-3.5 w-3.5 stroke-[1.75]" />
            </button>
          ) : null}
        </div>
      );
    });
  }

  return (
    <>
      {mobileOpen ? (
        <button
          type="button"
          className="app-sidebar-backdrop"
          aria-label="Close sidebar"
          onClick={onMobileClose}
        />
      ) : null}

      <aside
        className={`app-sidebar${showCompact ? " is-compact" : ""}${
          mobileOpen ? " is-open" : ""
        }`}
      >
        <div className="app-sidebar-inner">
          <div className="app-sidebar-head">
            {!showCompact ? (
              <span className="app-sidebar-title">Chats</span>
            ) : null}
            <div className="app-sidebar-head-actions">
              {!showCompact ? (
                <button
                  type="button"
                  className="app-sidebar-new"
                  onClick={() => {
                    onNewChat("main");
                    onMobileClose();
                  }}
                  title="New chat"
                  aria-label="New chat"
                >
                  <IconPlus className={appIconClass} />
                  <span>New chat</span>
                </button>
              ) : null}
              {desktopCompact ? (
                <button
                  type="button"
                  className="app-sidebar-toggle"
                  onClick={() => setRailOpen((open) => !open)}
                  aria-label={showCompact ? "Open chat rail" : "Collapse chat rail"}
                  title={showCompact ? "Open chats" : "Collapse chats"}
                >
                  {showCompact ? (
                    <IconChevronRight className={appIconClass} />
                  ) : (
                    <IconChevronLeft className={appIconClass} />
                  )}
                </button>
              ) : null}
            </div>
          </div>

          <div className="app-sidebar-list">
            {showCompact ? null : isLoading ? (
              <div className="app-sidebar-loading">
                <PulseDotLoader size="sm" className="bg-[#888]" />
                <p className="app-sidebar-empty">Loading conversations...</p>
              </div>
            ) : (
              <>
                <input
                  type="search"
                  className="app-sidebar-search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search chats..."
                />

                <div className="app-sidebar-section">
                  <div className="app-sidebar-section-head">
                    <p className="app-sidebar-section-title">Main chat</p>
                    <button
                      type="button"
                      className="app-sidebar-section-new"
                      onClick={() => {
                        onNewChat("main");
                        onMobileClose();
                      }}
                      title="New main chat"
                      aria-label="New main chat"
                    >
                      <IconPlus className={appIconClass} />
                    </button>
                  </div>
                  {mainThreads.length === 0 ? (
                    <p className="app-sidebar-empty">
                      {query ? "No matching main chats." : "No main chats yet."}
                    </p>
                  ) : (
                    renderThreadList(mainThreads)
                  )}
                </div>

                <div className="app-sidebar-section">
                  <div className="app-sidebar-section-head">
                    <p className="app-sidebar-section-title">Side conversations</p>
                    <button
                      type="button"
                      className="app-sidebar-section-new"
                      onClick={() => {
                        onNewChat("side");
                        onMobileClose();
                      }}
                      title="New side conversation"
                      aria-label="New side conversation"
                    >
                      <IconPlus className={appIconClass} />
                    </button>
                  </div>
                  {sideThreads.length === 0 ? (
                    <p className="app-sidebar-empty">
                      {query
                        ? "No matching side conversations."
                        : "Extra threads for side topics — start one here."}
                    </p>
                  ) : (
                    renderThreadList(sideThreads)
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

export function SidebarMenuButton({
  onClick,
}: {
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="app-icon-btn app-sidebar-menu-btn"
      onClick={onClick}
      aria-label="Open conversations"
      title="Conversations"
    >
      <IconMenu2 className={appIconClass} />
    </button>
  );
}
