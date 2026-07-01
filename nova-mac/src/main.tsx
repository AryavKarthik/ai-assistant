import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/global.css";
import "./styles/glass.css";
import { App } from "./App";
import { AppShell } from "./AppShell";
import { nova } from "./lib/ipc";

async function mount() {
  const root = document.getElementById("root")!;

  let mode = "orb";
  try {
    mode = await nova().getWindowMode();
  } catch {
    // fallback to orb if IPC not yet wired
  }

  createRoot(root).render(
    <StrictMode>
      {mode === "app" ? <AppShell /> : <App />}
    </StrictMode>,
  );
}

void mount();
