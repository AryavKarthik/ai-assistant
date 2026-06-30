import type { gmail_v1 } from "googleapis";
import {
  getGoogleTokenRow,
  isGoogleServiceConnected,
} from "./db-tokens";
import { getGmailClient } from "./client";
import {
  GMAIL_COMPOSE_SCOPE_ERROR,
  GMAIL_NOT_CONNECTED,
  isInsufficientScopeError,
} from "./errors";
import { stripHtmlToText } from "./html";
import { hasGmailComposeScope } from "./scopes";

const MAX_SEARCH_RESULTS = 25;

const GMAIL_INBOX_PATTERN =
  /\b(email|emails|gmail|inbox|unread|mailbox|mail)\b/i;
const GMAIL_COMPOSE_PATTERN =
  /\b(?:draft|write|compose)\s+(?:an?\s+)?email\b/i;
const GMAIL_REPLY_PATTERN =
  /\breply\s+to\s+(?:that|the|this)\s+email\b/i;
const GMAIL_SEND_PATTERN = /\bsend\s+(?:an?\s+)?email\s+to\b/i;

/** Inbox read/summarize — used for unread pre-retrieval only. */
export function isGmailInboxRecall(message: string): boolean {
  return GMAIL_INBOX_PATTERN.test(message);
}

/** Any Gmail-related chat intent (inbox, compose, reply). */
export function isGmailContextIntent(message: string): boolean {
  return (
    isGmailInboxRecall(message) ||
    GMAIL_COMPOSE_PATTERN.test(message) ||
    GMAIL_REPLY_PATTERN.test(message) ||
    GMAIL_SEND_PATTERN.test(message) ||
    /\bemail\s+.+\s+about\b/i.test(message)
  );
}

interface GmailMessageSummary {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
}

interface GmailMessageDetail extends GmailMessageSummary {
  body: string;
}

interface GmailDraftInput {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
  reply_to_message_id?: string;
}

interface GmailDraftResult {
  draftId: string;
  messageId: string;
  threadId: string;
  to: string;
  subject: string;
  preview: string;
}

function formatGmailError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (isInsufficientScopeError(message)) {
    return GMAIL_COMPOSE_SCOPE_ERROR;
  }
  return message;
}

async function requireGmailComposeAccess(
  userId: string,
): Promise<{ error: string } | null> {
  const row = await getGoogleTokenRow(userId);
  if (!row || !isGoogleServiceConnected(row, "gmail")) {
    return { error: GMAIL_NOT_CONNECTED };
  }
  if (!hasGmailComposeScope(row.scopes)) {
    return { error: GMAIL_COMPOSE_SCOPE_ERROR };
  }
  return null;
}

function encodeRawMessage(raw: string): string {
  return Buffer.from(raw)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function foldHeaderValue(value: string): string {
  return value.replace(/\r?\n/g, " ").trim();
}

function buildRawMessage(input: {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
  inReplyTo?: string;
  references?: string;
}): string {
  const lines = [
    `To: ${foldHeaderValue(input.to)}`,
    `Subject: ${foldHeaderValue(input.subject)}`,
  ];

  if (input.cc?.trim()) {
    lines.push(`Cc: ${foldHeaderValue(input.cc)}`);
  }
  if (input.bcc?.trim()) {
    lines.push(`Bcc: ${foldHeaderValue(input.bcc)}`);
  }
  if (input.inReplyTo?.trim()) {
    lines.push(`In-Reply-To: ${foldHeaderValue(input.inReplyTo)}`);
  }
  if (input.references?.trim()) {
    lines.push(`References: ${foldHeaderValue(input.references)}`);
  }

  lines.push("Content-Type: text/plain; charset=utf-8");
  lines.push("MIME-Version: 1.0");
  lines.push("");
  lines.push(input.body.trim());

  return encodeRawMessage(lines.join("\r\n"));
}

async function getReplyHeaders(
  gmail: NonNullable<Awaited<ReturnType<typeof getGmailClient>>>,
  messageId: string,
): Promise<{
  threadId: string;
  inReplyTo?: string;
  references?: string;
  subject?: string;
} | null> {
  const { data } = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "metadata",
    metadataHeaders: ["Message-ID", "References", "Subject"],
  });

  if (!data.id) return null;
  const headers = data.payload?.headers;
  const messageIdHeader = getHeader(headers, "Message-ID");
  const references = getHeader(headers, "References");
  const subject = getHeader(headers, "Subject");

  return {
    threadId: data.threadId ?? data.id,
    inReplyTo: messageIdHeader || undefined,
    references: references
      ? `${references} ${messageIdHeader}`.trim()
      : messageIdHeader || undefined,
    subject: subject || undefined,
  };
}

function ensureReplySubject(subject: string): string {
  const trimmed = subject.trim();
  if (!trimmed) return "Re:";
  if (/^re:/i.test(trimmed)) return trimmed;
  return `Re: ${trimmed}`;
}

export async function createGmailDraft(
  userId: string,
  input: GmailDraftInput,
): Promise<{ draft: GmailDraftResult } | { error: string }> {
  const accessError = await requireGmailComposeAccess(userId);
  if (accessError) return accessError;

  const gmail = await getGmailClient(userId);
  if (!gmail) return { error: GMAIL_NOT_CONNECTED };

  const to = input.to.trim();
  const body = input.body.trim();
  if (!to) return { error: "Recipient (to) is required" };
  if (!body) return { error: "Email body is required" };

  try {
    let subject = input.subject.trim();
    let threadId: string | undefined;
    let inReplyTo: string | undefined;
    let references: string | undefined;

    if (input.reply_to_message_id) {
      const replyMeta = await getReplyHeaders(gmail, input.reply_to_message_id);
      if (replyMeta) {
        threadId = replyMeta.threadId;
        inReplyTo = replyMeta.inReplyTo;
        references = replyMeta.references;
        if (!subject && replyMeta.subject) {
          subject = ensureReplySubject(replyMeta.subject);
        }
      }
    }

    if (!subject) {
      return { error: "Subject is required" };
    }

    const raw = buildRawMessage({
      to,
      subject,
      body,
      cc: input.cc,
      bcc: input.bcc,
      inReplyTo,
      references,
    });

    const { data } = await gmail.users.drafts.create({
      userId: "me",
      requestBody: {
        message: {
          raw,
          threadId,
        },
      },
    });

    const draftId = data.id;
    const messageId = data.message?.id;
    if (!draftId || !messageId) {
      return { error: "Failed to create Gmail draft" };
    }

    const preview = body.length > 160 ? `${body.slice(0, 157)}...` : body;

    return {
      draft: {
        draftId,
        messageId,
        threadId: data.message?.threadId ?? threadId ?? messageId,
        to,
        subject,
        preview,
      },
    };
  } catch (error) {
    return { error: formatGmailError(error) };
  }
}

export async function sendGmailDraft(
  userId: string,
  draftId: string,
): Promise<{ messageId: string; threadId: string } | { error: string }> {
  const accessError = await requireGmailComposeAccess(userId);
  if (accessError) return accessError;

  const gmail = await getGmailClient(userId);
  if (!gmail) return { error: GMAIL_NOT_CONNECTED };

  try {
    const { data } = await gmail.users.drafts.send({
      userId: "me",
      requestBody: { id: draftId },
    });

    if (!data.id) {
      return { error: "Failed to send Gmail draft" };
    }

    return {
      messageId: data.id,
      threadId: data.threadId ?? data.id,
    };
  } catch (error) {
    return { error: formatGmailError(error) };
  }
}

function getHeader(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
  name: string,
): string {
  const found = headers?.find(
    (h) => h.name?.toLowerCase() === name.toLowerCase(),
  );
  return found?.value ?? "";
}

function decodeBase64Url(data: string): string {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}

function extractBodyFromPart(part: gmail_v1.Schema$MessagePart): string {
  if (part.body?.data) {
    const raw = decodeBase64Url(part.body.data);
    if (part.mimeType === "text/html") {
      return stripHtmlToText(raw);
    }
    return raw.trim();
  }

  if (part.parts?.length) {
    const plain = part.parts.find((p) => p.mimeType === "text/plain");
    if (plain) return extractBodyFromPart(plain);
    const html = part.parts.find((p) => p.mimeType === "text/html");
    if (html) return extractBodyFromPart(html);
    return part.parts.map(extractBodyFromPart).join("\n").trim();
  }

  return "";
}

function mapMessageSummary(
  message: gmail_v1.Schema$Message,
): GmailMessageSummary | null {
  if (!message.id) return null;
  const headers = message.payload?.headers;
  return {
    id: message.id,
    threadId: message.threadId ?? message.id,
    from: getHeader(headers, "From"),
    subject: getHeader(headers, "Subject") || "(no subject)",
    date: getHeader(headers, "Date"),
    snippet: message.snippet ?? "",
  };
}

export async function searchGmail(
  userId: string,
  query: string,
  maxResults = 10,
): Promise<{ messages: GmailMessageSummary[] } | { error: string }> {
  const gmail = await getGmailClient(userId);
  if (!gmail) return { error: GMAIL_NOT_CONNECTED };

  const limit = Math.min(maxResults, MAX_SEARCH_RESULTS);
  const list = await gmail.users.messages.list({
    userId: "me",
    q: query,
    maxResults: limit,
  });

  const ids = list.data.messages ?? [];
  const messages: GmailMessageSummary[] = [];

  for (const item of ids) {
    if (!item.id) continue;
    const { data } = await gmail.users.messages.get({
      userId: "me",
      id: item.id,
      format: "metadata",
      metadataHeaders: ["From", "Subject", "Date"],
    });
    const summary = mapMessageSummary(data);
    if (summary) messages.push(summary);
  }

  return { messages };
}

export async function getGmailMessage(
  userId: string,
  messageId: string,
): Promise<{ message: GmailMessageDetail } | { error: string }> {
  const gmail = await getGmailClient(userId);
  if (!gmail) return { error: GMAIL_NOT_CONNECTED };

  const { data } = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });

  const summary = mapMessageSummary(data);
  if (!summary) return { error: "Message not found" };

  const body = data.payload ? extractBodyFromPart(data.payload) : "";
  return {
    message: {
      ...summary,
      body: body.slice(0, 12000),
    },
  };
}

export async function getUnreadHighlights(
  userId: string,
  limit = 3,
): Promise<string[]> {
  const result = await searchGmail(userId, "is:unread", limit);
  if ("error" in result) return [];

  return result.messages.map(
    (m) =>
      `- [gmail unread id=${m.id}] From: ${m.from} — ${m.subject}`,
  );
}
