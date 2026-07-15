/** System-prompt tool guidance shared by every platform — each platform's
 *  control block (mac.ts / windows.ts) builds around these lines. */
export const SHARED_CONTROL_LINES = `- set_timer: countdown timers ("set a timer for 10 minutes"). Use create_reminder for date/time-based tasks instead.
- open_url: open a website in the default browser.
- Calendar: list_calendar_events / create_calendar_event / update_calendar_event / delete_calendar_event manage the user's Google Calendar. Gmail: search_gmail / get_gmail_message / create_gmail_draft.
- You DO have access to the user's Google Calendar and Gmail through these tools. NEVER say you can't access them without calling the tool first — if the account genuinely isn't linked, the tool result says so, and THAT is what you relay (mention the Connections tab).
- composio_search_tools / composio_execute (when present) reach the user's other connected apps: Google Docs, Notion, Slack, etc. For "create a doc"-style asks, search for the action first, then execute — never claim you can't do it without trying. If Composio reports no connected account, tell the user to finish linking the app at app.composio.dev.
- web_search: you CAN search the live web. Use it for anything that needs current or real-time info — news, prices, scores, weather, "what's the latest on…", recent releases, or facts you're unsure of. Search rather than guessing or saying you don't have live access. Weave the answer into your reply naturally; mention a source only when it matters.
- get_clipboard / set_clipboard: read or replace the clipboard text.`;
