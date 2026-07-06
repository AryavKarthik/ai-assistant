import type { Tool } from "@anthropic-ai/sdk/resources/messages";

// Tool schemas Claude sees — add new tools here.
export const TOOL_DEFINITIONS: Tool[] = [
  {
    name: "save_memory",
    description:
      "Store or update a durable fact, preference, goal, or lifestyle pattern. REQUIRED proactively whenever the user shares personal context — even casually — without asking permission. Examples: where they live/work, gym habits, sleep schedule, weekly routines, diet, allergies, family, likes/dislikes, goals, 'I usually…', 'every week I…'. Use multiple calls per turn for multiple facts. Pass replaces_memory_id when updating a memory from context. School, university, and college are the same education topic.",
    input_schema: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "The memory in clear natural language",
        },
        category: {
          type: "string",
          enum: ["preference", "fact", "goal", "other"],
        },
        replaces_memory_id: {
          type: "string",
          description:
            "Optional memory UUID to replace when updating a known fact",
        },
      },
      required: ["content"],
    },
  },
  {
    name: "search_memory",
    description:
      "Search stored memories when pre-fetched context is insufficient. Use for specific recall questions.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "integer" },
      },
      required: ["query"],
    },
  },
  {
    name: "log_workout",
    description:
      "Log a workout or exercise session. Ask for missing key details if ambiguous.",
    input_schema: {
      type: "object",
      properties: {
        exercise: { type: "string" },
        sets: { type: "integer" },
        reps: { type: "integer" },
        weight_kg: { type: "number" },
        duration_min: { type: "integer" },
        notes: { type: "string" },
      },
      required: ["exercise"],
    },
  },
  {
    name: "list_workouts",
    description:
      "List recent workout sessions. Use when the user asks about gym history beyond pre-fetched context.",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "integer" },
        since: {
          type: "string",
          description: "ISO 8601 datetime — only workouts on or after this date",
        },
      },
    },
  },
  {
    name: "search_workouts",
    description:
      "Search workouts by exercise name or date range. Use for specific exercise history.",
    input_schema: {
      type: "object",
      properties: {
        exercise: { type: "string" },
        since: {
          type: "string",
          description: "ISO 8601 datetime — only workouts on or after this date",
        },
        limit: { type: "integer" },
      },
    },
  },
  {
    name: "create_reminder",
    description:
      "REQUIRED when the user asks for a reminder. Creates a stored task visible on the Reminders tab. Must be called before you confirm the reminder exists. Set due_at (ISO 8601) when the user gives a time.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        due_at: {
          type: "string",
          description: "ISO 8601 datetime, optional",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "list_reminders",
    description:
      "List the user's reminders. Use when they ask what reminders they have or what's coming up.",
    input_schema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["pending", "done", "cancelled", "all"],
          description: "Filter by status. Defaults to pending.",
        },
        limit: { type: "integer" },
      },
    },
  },
  {
    name: "complete_reminder",
    description:
      "Mark a reminder as done. Provide id when possible; otherwise match by title.",
    input_schema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Reminder UUID from list_reminders",
        },
        title: {
          type: "string",
          description:
            "Match by title if id is unknown. Must match exactly one pending reminder.",
        },
      },
      required: [],
    },
  },
  {
    name: "complete_all_reminders",
    description:
      "Mark every pending reminder as done. Use when the user wants to clear or complete all reminders.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "delete_all_reminders",
    description:
      "Permanently delete every pending reminder. Use when the user asks to delete or clear all reminders.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "delete_reminder",
    description: "Permanently delete one reminder by id from list_reminders.",
    input_schema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Reminder UUID from list_reminders",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "list_calendar_events",
    description:
      "List Google Calendar events for a date range. Use for schedule questions beyond pre-fetched context. Requires linked Google Calendar.",
    input_schema: {
      type: "object",
      properties: {
        time_min: {
          type: "string",
          description: "ISO 8601 datetime — range start (defaults to now)",
        },
        time_max: {
          type: "string",
          description: "ISO 8601 datetime — range end (defaults to 7 days ahead)",
        },
        max_results: { type: "integer" },
      },
    },
  },
  {
    name: "create_calendar_event",
    description:
      "Create an event on the user's Google Calendar (primary). Use for meetings, appointments, and time blocks. Requires linked Google Calendar.",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "Event title" },
        start: {
          type: "string",
          description: "ISO 8601 datetime or date (YYYY-MM-DD for all-day)",
        },
        end: {
          type: "string",
          description: "ISO 8601 datetime or date (YYYY-MM-DD for all-day)",
        },
        description: { type: "string" },
        location: { type: "string" },
        attendees: {
          type: "array",
          items: { type: "string" },
          description: "Attendee email addresses",
        },
      },
      required: ["summary", "start", "end"],
    },
  },
  {
    name: "update_calendar_event",
    description:
      "Update an existing Google Calendar event by event_id. Confirm with the user before changing or cancelling ambiguous events.",
    input_schema: {
      type: "object",
      properties: {
        event_id: { type: "string" },
        summary: { type: "string" },
        start: { type: "string" },
        end: { type: "string" },
        description: { type: "string" },
        location: { type: "string" },
      },
      required: ["event_id"],
    },
  },
  {
    name: "delete_calendar_event",
    description:
      "Delete a Google Calendar event by event_id. Confirm with the user before deleting.",
    input_schema: {
      type: "object",
      properties: {
        event_id: { type: "string" },
      },
      required: ["event_id"],
    },
  },
  {
    name: "search_gmail",
    description:
      "Search Gmail using Gmail query syntax. Read-only. Requires linked Gmail at /connections.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Gmail search query" },
        max_results: { type: "integer" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_gmail_message",
    description:
      "Get a Gmail message by ID with plain-text body. Read-only. Use after search_gmail.",
    input_schema: {
      type: "object",
      properties: {
        message_id: { type: "string" },
      },
      required: ["message_id"],
    },
  },
  {
    name: "create_gmail_draft",
    description:
      "Create a Gmail draft for the user to review. Does NOT send email. The user must tap Send on the draft receipt in chat after reviewing. Requires linked Gmail with compose permission at /connections.",
    input_schema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Recipient email address" },
        subject: { type: "string", description: "Optional when replying in-thread" },
        body: { type: "string", description: "Plain-text email body" },
        cc: { type: "string" },
        bcc: { type: "string" },
        reply_to_message_id: {
          type: "string",
          description: "Optional Gmail message id to reply in-thread",
        },
      },
      required: ["to", "body"],
    },
  },
  {
    name: "send_email",
    description:
      "Actually SEND an email via the user's Gmail. Use this when the user asks to send an email (not just draft one). Because sending is irreversible, confirm the recipient and gist with the user first, then call this. Requires linked Gmail at /connections; if it errors about permission/scope, tell the user to reconnect Gmail there.",
    input_schema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Recipient email address" },
        subject: { type: "string", description: "Subject line" },
        body: { type: "string", description: "Plain-text email body" },
        cc: { type: "string" },
        bcc: { type: "string" },
        reply_to_message_id: {
          type: "string",
          description: "Optional Gmail message id to reply in-thread",
        },
      },
      required: ["to", "body"],
    },
  },
  {
    name: "get_youtube_taste_profile",
    description:
      "Get cached YouTube taste profile (subscriptions/likes summary). Requires linked YouTube.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "search_youtube",
    description:
      "Search YouTube videos by topic. Requires linked YouTube.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        max_results: { type: "integer" },
        duration: {
          type: "string",
          enum: ["short", "medium", "long"],
        },
      },
      required: ["query"],
    },
  },
  {
    name: "recommend_youtube",
    description:
      "Recommend YouTube videos for a topic using taste profile + search. Explain picks in your reply.",
    input_schema: {
      type: "object",
      properties: {
        topic: { type: "string" },
      },
      required: ["topic"],
    },
  },
  // NOTE: web search is provided by Anthropic's native server-side web_search
  // tool (added in electron/chat-turn.ts), not a client-side tool here — it
  // runs on Anthropic's infrastructure and needs no separate search API key.
  {
    name: "set_timer",
    description:
      "Set a countdown timer. By default this uses Nova's own reliable timer (chime + macOS notification + Nova popup when it fires) — prefer this. Set in_clock_app: true ONLY when the user explicitly wants it in the macOS Clock app; that drives Clock's UI and needs Accessibility permission (the tool result will say if it's missing). For date/time-based tasks use create_reminder instead.",
    input_schema: {
      type: "object",
      properties: {
        duration_seconds: {
          type: "integer",
          description: "Timer length in seconds (e.g. 600 for 10 minutes)",
        },
        label: {
          type: "string",
          description: "Short label spoken/shown when the timer fires, e.g. 'Pasta'",
        },
        in_clock_app: {
          type: "boolean",
          description: "Set the timer inside the macOS Clock app instead of Nova's own timer. Only when the user specifically asks for the Clock app.",
        },
      },
      required: ["duration_seconds"],
    },
  },
  {
    name: "list_timers",
    description: "List currently running countdown timers with time remaining.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "cancel_timer",
    description:
      "Cancel a running countdown timer by id from list_timers, or all timers.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Timer id from list_timers" },
        all: { type: "boolean", description: "Cancel every running timer" },
      },
    },
  },
  {
    name: "open_app",
    description:
      "Open (launch or focus) a macOS application by name, e.g. 'Safari', 'Google Chrome', 'Spotify', 'Notes'. Use when the user asks to open a browser or any app.",
    input_schema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Application name as it appears in /Applications",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "quit_app",
    description: "Quit a running macOS application by name.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
      },
      required: ["name"],
    },
  },
  {
    name: "open_url",
    description:
      "Open a URL in the user's default browser. Use after web_search when the user wants to view a page, or when they ask to open a specific site.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Full http(s) URL" },
      },
      required: ["url"],
    },
  },
  {
    name: "set_system_volume",
    description:
      "Set this Mac's output volume (0–100) and/or mute state. Use for 'turn the volume up/down/to 50%', 'mute'. For relative changes, call get_system_volume first.",
    input_schema: {
      type: "object",
      properties: {
        level: { type: "integer", description: "Output volume 0–100" },
        muted: { type: "boolean" },
      },
    },
  },
  {
    name: "get_system_volume",
    description: "Get this Mac's current output volume (0–100) and mute state.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "set_screen_brightness",
    description:
      "Set or nudge this Mac's display brightness. Pass level (0.0–1.0) for absolute, or direction up/down for relative. May require the Accessibility permission on first use.",
    input_schema: {
      type: "object",
      properties: {
        level: { type: "number", description: "Absolute brightness 0.0–1.0" },
        direction: { type: "string", enum: ["up", "down"] },
        steps: {
          type: "integer",
          description: "Steps for relative change (1–16, default 2)",
        },
      },
    },
  },
  {
    name: "fetch_webpage",
    description:
      "Fetch and read the text content of a specific URL. Use after web_search to read a result in detail, or when the user provides a link they want summarized. Returns cleaned page text (up to 3000 chars). An 'Open' button will appear in chat for the user to view the page.",
    input_schema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Full URL to fetch (must start with http:// or https://)",
        },
      },
      required: ["url"],
    },
  },
  // ─── Browser control (Google Chrome) ─────────────────────────────────────────
  {
    name: "list_browser_tabs",
    description:
      "List every open tab in Google Chrome with its title, URL, and which one is active. Use to answer 'what do I have open', to find a tab before switching/closing it, or before reading a specific page.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "open_browser_tab",
    description:
      "Open a URL in a new Google Chrome tab (launches Chrome if needed) and bring it to the front. Prefer this over open_url when the user is working in Chrome or you'll act on the page next.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Full http(s) URL" },
      },
      required: ["url"],
    },
  },
  {
    name: "activate_browser_tab",
    description:
      "Switch Google Chrome to a specific tab and focus it. Get tab_index (and window_index) from list_browser_tabs first.",
    input_schema: {
      type: "object",
      properties: {
        tab_index: { type: "integer", description: "1-based tab index from list_browser_tabs" },
        window_index: { type: "integer", description: "1-based window index (default 1)" },
      },
      required: ["tab_index"],
    },
  },
  {
    name: "close_browser_tab",
    description:
      "Close a specific Google Chrome tab. Get tab_index (and window_index) from list_browser_tabs first. Confirm with the user before closing tabs that may contain unsaved work.",
    input_schema: {
      type: "object",
      properties: {
        tab_index: { type: "integer", description: "1-based tab index from list_browser_tabs" },
        window_index: { type: "integer", description: "1-based window index (default 1)" },
      },
      required: ["tab_index"],
    },
  },
  {
    name: "read_browser_page",
    description:
      "Read the visible text of the active Google Chrome tab (its title, URL, and innerText). Use for 'summarize this page/tab', 'what does this article say', or to extract info the user is looking at. Requires Chrome's 'Allow JavaScript from Apple Events' setting.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "run_browser_js",
    description:
      "Execute JavaScript in the active Google Chrome tab and return the result as a string. Use for agentic web tasks: click buttons (element.click()), fill inputs, extract structured data (querySelectorAll), scroll, or read page state. The last expression's value is returned. Requires Chrome's 'Allow JavaScript from Apple Events' setting.",
    input_schema: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description:
            "JavaScript to run in the page. Can be multiple statements; use 'return' for the value, e.g. return document.querySelectorAll('a').length",
        },
      },
      required: ["code"],
    },
  },
  // ─── Mac automation (full power) ─────────────────────────────────────────────
  {
    name: "run_applescript",
    description:
      "Run an AppleScript on this Mac to control and navigate WITHIN apps and browsers — not just launch them. Use for anything the dedicated tools can't do: set a timer in the Clock app, create a note in Notes, control Safari/Chrome tabs (open location, read the current tab's URL/title, run JavaScript in a tab), play a playlist in Music, send an iMessage, click UI elements via System Events, etc. Compose the smallest script that does the job and return useful output with `return`. Scripts run with the user's full permissions: never write destructive scripts (deleting files, closing unsaved work) unless the user explicitly asked. If the result mentions a missing Accessibility/Automation permission, relay those exact fix steps to the user.",
    input_schema: {
      type: "object",
      properties: {
        script: {
          type: "string",
          description: "The complete AppleScript source to execute",
        },
        purpose: {
          type: "string",
          description: "One short sentence describing what this script does (shown in logs)",
        },
      },
      required: ["script"],
    },
  },
  {
    name: "run_shortcut",
    description:
      "Run one of the user's macOS Shortcuts by exact name, optionally passing text input. Use list_shortcuts first if unsure of the name. Shortcuts are often the most reliable way to do things AppleScript can't (e.g. actions from sandboxed apps).",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Exact Shortcut name" },
        input: { type: "string", description: "Optional text input passed to the shortcut" },
      },
      required: ["name"],
    },
  },
  {
    name: "list_shortcuts",
    description: "List the names of the user's installed macOS Shortcuts.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "see_screen",
    description:
      "Capture and look at what's currently on the user's screen, then answer using what you see. Call this whenever the user refers to their screen or something in front of them — 'what does this say?', 'what's this error?', 'summarize this', 'what app is this?', 'is this safe to click?', 'read this to me', or any 'this/here/that' that only makes sense visually. After it returns the screenshot, describe or act on the actual content. Requires macOS Screen Recording permission (the result explains if it's missing).",
    input_schema: {
      type: "object",
      properties: {
        display: {
          type: "integer",
          description: "Which display to capture (1 = main, default). Only set for multi-monitor.",
        },
      },
    },
  },
  {
    name: "run_shell_command",
    description:
      "Run an arbitrary shell command (zsh) on this Mac and return stdout/stderr plus the exit code. Use for file operations, git, launching CLIs, reading system info, or anything the curated tools don't cover. Explain what you're about to do before running anything destructive (rm, overwriting files, etc.).",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "The shell command to run" },
      },
      required: ["command"],
    },
  },
  {
    name: "search_files",
    description:
      "Find files and folders on this Mac by name or content using Spotlight (mdfind). Use for 'find my resume', 'where is that PDF', 'locate the photos folder'. Returns matching paths; open one with open_path.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search text — matched against file names and content" },
        kind: {
          type: "string",
          enum: ["pdf", "image", "video", "audio", "document", "folder", "app"],
          description: "Optional filter by file kind",
        },
        limit: { type: "integer", description: "Max results (default 20, max 100)" },
      },
      required: ["query"],
    },
  },
  {
    name: "open_path",
    description:
      "Open a file, folder, or app by its filesystem path using the default handler (like double-clicking in Finder). Use after search_files to open a result.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute filesystem path" },
      },
      required: ["path"],
    },
  },
  {
    name: "open_settings",
    description:
      "Open a specific pane of macOS System Settings. Use for 'open wifi settings', 'take me to display settings', 'open bluetooth'. Pass the pane name; unknown names open System Settings at its root.",
    input_schema: {
      type: "object",
      properties: {
        pane: {
          type: "string",
          description:
            "Pane name, e.g. wifi, bluetooth, network, displays, sound, notifications, battery, keyboard, trackpad, privacy, accessibility, appearance, storage, focus, wallpaper, software_update",
        },
      },
      required: ["pane"],
    },
  },
  {
    name: "get_clipboard",
    description: "Read the current text contents of the Mac clipboard.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "set_clipboard",
    description: "Replace the Mac clipboard with the given text so the user can paste it.",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to copy to the clipboard" },
      },
      required: ["text"],
    },
  },
  {
    name: "take_screenshot",
    description:
      "Capture a screenshot of this Mac to a PNG file and return its path. Set interactive=true to let the user select a region or window; otherwise the full screen is captured silently.",
    input_schema: {
      type: "object",
      properties: {
        interactive: {
          type: "boolean",
          description: "If true, user picks a region/window; default false (full screen)",
        },
      },
    },
  },
  {
    name: "control_media",
    description:
      "Play/pause or skip whatever audio is currently playing on the Mac — YouTube Music in a browser, Spotify, Apple Music, a video, etc. Use for 'pause', 'resume', 'play/pause', 'skip', 'next song', 'previous song', 'go back'. This is the reliable way to control playback that's already going. Needs Accessibility permission (the result says so if it's missing).",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["playpause", "next", "previous"],
          description: "playpause toggles play/pause; next skips forward; previous goes back",
        },
      },
      required: ["action"],
    },
  },
  {
    name: "play_youtube",
    description:
      "Play a song, video, or anything on YouTube. Opens the top matching video playing in the browser. Use whenever the user asks to play music, a song, or a video ('play Blinding Lights', 'put on some lofi', 'play that trailer'). For pause/skip once it's playing, use control_media.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "What to play — e.g. 'Blinding Lights', 'lofi beats', 'SpaceX launch'",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "check_mac_permissions",
    description:
      "Check whether Nova has macOS Accessibility permission (needed to control apps/browsers via UI scripting — e.g. setting a Clock timer, clicking around in Safari/Chrome). Call this when a UI-automation attempt failed on permissions, or when the user asks why app control isn't working. If not granted, opening the Settings pane is offered.",
    input_schema: {
      type: "object",
      properties: {
        open_settings: {
          type: "boolean",
          description: "If true and permission is missing, open System Settings to the Accessibility pane.",
        },
      },
    },
  },
  {
    name: "create_agent_loop",
    description:
      "Schedule a task Nova runs autonomously later — a full turn with all tools, whose result is announced out loud. REQUIRED whenever the user asks YOU to do something at a future time or on a repeat: 'send me an email at 10:30 with X', 'every morning at 8 check my calendar and brief me', 'in an hour, check if that page is back up'. Never promise to do something later without creating a loop — you have no other way to act in the future. For plain 'remind me' asks use create_reminder instead; loops are for tasks Nova performs.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Short label, e.g. 'Morning brief'" },
        instruction: {
          type: "string",
          description:
            "What to do at run time, written as a complete standalone instruction with every detail needed (recipients, content, what to check). No user is present when it runs.",
        },
        schedule_type: { type: "string", enum: ["once", "daily", "interval"] },
        at: {
          type: "string",
          description: "For once: ISO 8601 datetime (compute from <runtime_context>)",
        },
        time_local: { type: "string", description: "For daily: 'HH:MM' 24h local time" },
        every_minutes: { type: "integer", description: "For interval: run every N minutes" },
        speak_result: {
          type: "boolean",
          description: "Announce the result out loud when it runs (default true)",
        },
      },
      required: ["name", "instruction", "schedule_type"],
    },
  },
  {
    name: "list_agent_loops",
    description:
      "List the user's scheduled agent loops (autonomous tasks) with their schedules and last results. Use when they ask what's scheduled, or before deleting one.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "delete_agent_loop",
    description:
      "Delete/cancel a scheduled agent loop by id (from list_agent_loops). Use when the user cancels a scheduled task.",
    input_schema: {
      type: "object",
      properties: {
        loop_id: { type: "string" },
      },
      required: ["loop_id"],
    },
  },
  {
    name: "adjust_personality",
    description:
      "Permanently adjust how you talk/behave. REQUIRED whenever the user gives feedback about your style or personality — 'swear less', 'stop calling me boss', 'be more blunt', 'I love the banter, keep that', 'talk more like me'. Add a short trait note capturing the feedback (action 'add'), or remove one that no longer applies (action 'remove'). These traits are injected into every future conversation, so this is how you actually evolve — acknowledging feedback without calling this tool changes nothing.",
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["add", "remove"] },
        trait: {
          type: "string",
          description:
            "For add: the style note, imperative and concise, e.g. 'Don't call the user boss' or 'User loves roasts — lean into them'. For remove: the text (or a distinctive part) of the trait to drop.",
        },
      },
      required: ["action", "trait"],
    },
  },
  {
    name: "composio_search_tools",
    description:
      "Search the user's Composio-connected apps (Google Docs, Notion, Slack, ...) for actions matching a task, e.g. query 'create google doc'. Returns action slugs + descriptions. Use before composio_execute when you don't know the exact action slug. Pass include_schemas: true only when you need the argument schema.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What you want to do, e.g. 'append text to google doc'" },
        toolkit: { type: "string", description: "Optional app filter, e.g. 'googledocs', 'notion'" },
        limit: { type: "integer", description: "Max results (default 10)" },
        include_schemas: { type: "boolean", description: "Include input parameter schemas (verbose)" },
      },
    },
  },
  {
    name: "composio_execute",
    description:
      "Execute a Composio action by slug (from composio_search_tools), e.g. GOOGLEDOCS_CREATE_DOCUMENT with arguments {title, text}. If it errors about missing arguments, search again with include_schemas: true to get the schema. If it errors that the app isn't connected, tell the user to connect it at app.composio.dev.",
    input_schema: {
      type: "object",
      properties: {
        tool_slug: { type: "string", description: "Action slug, e.g. GOOGLEDOCS_CREATE_DOCUMENT" },
        arguments: { type: "object", description: "Action arguments per its schema" },
      },
      required: ["tool_slug"],
    },
  },
];

/** Tool list actually offered to Claude: Composio meta-tools are hidden until
 *  COMPOSIO_API_KEY is configured, so the model never wanders into a bridge
 *  that can only error. */
export function getToolDefinitions(): Tool[] {
  if (process.env.COMPOSIO_API_KEY?.trim()) return TOOL_DEFINITIONS;
  return TOOL_DEFINITIONS.filter((t) => !t.name.startsWith("composio_"));
}
