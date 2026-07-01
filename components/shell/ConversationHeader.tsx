"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  appIconClass,
  IconDotsVertical,
  IconDownload,
  IconPlus,
} from "./icons";
import { SidebarMenuButton } from "./ThreadSidebar";

interface ConversationHeaderProps {
  onOpenSidebar: () => void;
  onClear: () => void;
  onExtract: () => void;
}

export function ConversationHeader({
  onOpenSidebar,
  onClear,
  onExtract,
}: ConversationHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!menuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  const closeMenu = () => setMenuOpen(false);

  const handleNewChat = () => {
    closeMenu();
    onClear();
  };

  const handleDownload = () => {
    closeMenu();
    onExtract();
  };

  return (
    <header className="app-conversation-header">
      <div className="app-conversation-header-left">
        <SidebarMenuButton onClick={onOpenSidebar} />
      </div>

      <div className="app-overflow-menu" ref={menuRef}>
        <button
          type="button"
          className="app-icon-btn is-subtle"
          onClick={() => setMenuOpen((open) => !open)}
          aria-label="Conversation options"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls={menuId}
        >
          <IconDotsVertical className={appIconClass} />
        </button>

        {menuOpen && (
          <div
            id={menuId}
            className="app-dropdown"
            role="menu"
            aria-label="Conversation options"
          >
            <button
              type="button"
              className="app-dropdown-item"
              role="menuitem"
              onClick={handleNewChat}
            >
              <IconPlus className={appIconClass} aria-hidden />
              New chat
            </button>
            <button
              type="button"
              className="app-dropdown-item"
              role="menuitem"
              onClick={handleDownload}
            >
              <IconDownload className={appIconClass} aria-hidden />
              Download
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
