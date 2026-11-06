import { AlertTriangle, Info, Lightbulb, Sparkles, type LucideIcon } from "lucide-react";

export type CalloutTone = "gray" | "blue" | "yellow" | "red" | "purple";

const TONE_ICON: Record<CalloutTone, LucideIcon> = {
  gray: Info,
  blue: Info,
  yellow: Lightbulb,
  red: AlertTriangle,
  purple: Sparkles,
};

const TONE_STYLE: Record<CalloutTone, string> = {
  gray: "bg-callout-gray-bg text-callout-gray-text",
  blue: "bg-callout-blue-bg text-callout-blue-text",
  yellow: "bg-callout-yellow-bg text-callout-yellow-text",
  red: "bg-callout-red-bg text-callout-red-text",
  purple: "bg-callout-purple-bg text-callout-purple-text",
};

export function Callout({
  tone,
  mono = false,
  dark = false,
  children,
  action,
}: {
  tone: CalloutTone;
  mono?: boolean;
  // Reuses the fixed session palette (cream/terracotta) instead of the chrome
  // callout colors, for callouts rendered on top of session-palette surfaces
  // (e.g. BreakModal's espresso card) — keeps CLAUDE.md §4's palette boundary
  // intact rather than mixing it with the chrome accent system.
  dark?: boolean;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  const Icon = TONE_ICON[tone];
  return (
    <div
      className={`flex items-start gap-3 rounded-lg px-4 py-3 text-sm ${
        dark ? "bg-terracotta/15 text-cream" : TONE_STYLE[tone]
      }`}
    >
      <Icon size={18} strokeWidth={1.5} className={`mt-0.5 shrink-0 ${dark ? "text-terracotta" : ""}`} />
      <div className={`min-w-0 flex-1 ${mono ? "font-mono" : "font-serif"}`}>{children}</div>
      {action}
    </div>
  );
}
