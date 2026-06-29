"use client";

import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
} from "react";
import type { ChatActionReceipt } from "@/lib/chat/types";

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export function Card({
  className,
  elevated = false,
  ...props
}: HTMLAttributes<HTMLDivElement> & { elevated?: boolean }) {
  return (
    <div
      className={cx(elevated ? "ui-surface-elevated" : "ui-surface", className)}
      {...props}
    />
  );
}

export function Button({
  className,
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
}) {
  return (
    <button
      className={cx(
        "ui-button px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-55",
        variant === "primary" && "ui-button-primary",
        variant === "secondary" && "ui-button-secondary",
        variant === "ghost" &&
          "border-transparent bg-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
        className,
      )}
      {...props}
    />
  );
}

export function TextInput({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cx(
        "ui-input w-full px-3 py-2 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
}

export function TextArea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cx(
        "ui-input w-full px-3 py-2 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
}

export function Select({
  className,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cx(
        "ui-input w-full px-3 py-2 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
}

export function Badge({
  className,
  tone = "neutral",
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  tone?: "neutral" | "accent" | "success" | "warn" | "error";
}) {
  const tones: Record<string, string> = {
    neutral: "bg-[#141414] text-[var(--text-secondary)] border border-[var(--border-subtle)]",
    accent: "bg-[#1a1a1a] text-[#ccc] border border-[#3a3a3a]",
    success: "bg-[#141a14] text-[#9fdf9f] border border-[#2a3a2a]",
    warn: "bg-[#1a1810] text-[#d4b86a] border border-[#3a3420]",
    error: "bg-[#1a1010] text-[#e8a0a0] border border-[#3a2020]",
  };
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

export function Notice({
  className,
  tone = "neutral",
  title,
  actions,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  tone?: "neutral" | "success" | "warn" | "error";
  title?: string;
  actions?: ReactNode;
}) {
  const tones: Record<string, string> = {
    neutral: "border-[var(--border-subtle)] bg-[var(--surface-panel)] text-[var(--text-secondary)]",
    success: "border-[#2a3a2a] bg-[#141a14] text-[#9fdf9f]",
    warn: "border-[#3a3420] bg-[#1a1810] text-[#d4b86a]",
    error: "border-[#3a2020] bg-[#1a1010] text-[#e8a0a0]",
  };
  return (
    <div
      className={cx("rounded-xl border px-4 py-3 text-sm", tones[tone], className)}
      {...props}
    >
      {title ? <p className="mb-1 text-sm font-medium text-[var(--text-primary)]">{title}</p> : null}
      <div>{children}</div>
      {actions ? <div className="mt-2 flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({
  title,
  detail,
  className,
}: {
  title: string;
  detail?: string;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "ui-surface flex min-h-[180px] flex-col items-center justify-center gap-2 px-6 text-center",
        className,
      )}
    >
      <p className="text-sm font-medium text-[var(--text-primary)]">{title}</p>
      {detail ? <p className="text-sm ui-muted">{detail}</p> : null}
    </div>
  );
}

export function InlineError({
  message,
  className,
  actions,
}: {
  message: string;
  className?: string;
  actions?: ReactNode;
}) {
  return (
    <div className={cx("rounded-xl border border-[#3a2020] bg-[#1a1010] px-4 py-3", className)} role="alert">
      <p className="text-sm text-[#e8a0a0]">{message}</p>
      {actions ? <div className="mt-2 flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function ActionReceiptRow({
  receipt,
  onUndo,
  onConfirm,
  onDismiss,
  confirmBusy,
}: {
  receipt: ChatActionReceipt;
  onUndo?: (receipt: ChatActionReceipt) => void;
  onConfirm?: (receipt: ChatActionReceipt) => void;
  onDismiss?: (receipt: ChatActionReceipt) => void;
  confirmBusy?: boolean;
}) {
  const toneClass =
    receipt.status === "success"
      ? "border-[#2a3a2a] bg-[#141a14] text-[#9fdf9f]"
      : receipt.status === "error"
        ? "border-[#3a2020] bg-[#1a1010] text-[#e8a0a0]"
        : "border-[var(--border-subtle)] bg-[var(--surface-panel)] text-[var(--text-secondary)]";

  // WorkflowCard renders its own full-size card; skip the compact row for it
  if (receipt.confirm?.type === "approve_workflow" && !receipt.dismissed) {
    return null;
  }

  return (
    <div className={cx("flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-xs", toneClass)}>
      <div className="min-w-0">
        <p className="truncate font-medium">{receipt.action}</p>
        <p className="truncate opacity-85">{receipt.outcome}</p>
        {receipt.confirm?.type === "send_gmail_draft" && !receipt.dismissed ? (
          <div className="mt-1 space-y-0.5 opacity-90">
            {receipt.confirm.to ? (
              <p className="truncate">
                <span className="opacity-70">To:</span> {receipt.confirm.to}
              </p>
            ) : null}
            {receipt.confirm.subject ? (
              <p className="truncate">
                <span className="opacity-70">Subject:</span> {receipt.confirm.subject}
              </p>
            ) : null}
            {receipt.confirm.preview ? (
              <p className="line-clamp-2 whitespace-pre-wrap">
                <span className="opacity-70">Body:</span> {receipt.confirm.preview}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {receipt.confirm?.type === "send_gmail_draft" && !receipt.dismissed && onConfirm ? (
          <>
            <Button
              type="button"
              variant="primary"
              className="px-2 py-1 text-xs"
              disabled={confirmBusy}
              onClick={() => onConfirm(receipt)}
            >
              {confirmBusy ? "Sending…" : "Send"}
            </Button>
            {onDismiss ? (
              <Button
                type="button"
                variant="ghost"
                className="px-2 py-1 text-xs"
                disabled={confirmBusy}
                onClick={() => onDismiss(receipt)}
              >
                Dismiss
              </Button>
            ) : null}
          </>
        ) : null}
        {receipt.confirm?.type === "open_browser_tab" && !receipt.dismissed ? (
          <a
            href={receipt.confirm.url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]"
          >
            Open
          </a>
        ) : null}
        {receipt.undo && onUndo ? (
          <Button
            type="button"
            variant="ghost"
            className="px-2 py-1 text-xs"
            onClick={() => onUndo(receipt)}
          >
            Undo
          </Button>
        ) : null}
      </div>
    </div>
  );
}
