import type { ActivityMode } from "../types";

// Hand-drawn glyphs per cognitive mode — not in lucide's set, so this stays custom.
export function ModeIcon({ mode, className }: { mode: ActivityMode; className?: string }) {
  const props = {
    viewBox: "0 0 24 24",
    width: "1em",
    height: "1em",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    className,
  };
  switch (mode) {
    case "silent":
      return (
        <svg {...props}>
          <path d="M4 18v-6a8 8 0 0 1 16 0v6" />
          <rect x="2" y="15" width="4" height="6" rx="1.5" />
          <rect x="18" y="15" width="4" height="6" rx="1.5" />
        </svg>
      );
    case "writing":
      return (
        <svg {...props}>
          <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
        </svg>
      );
    case "pitch":
      return (
        <svg {...props}>
          <rect x="2" y="10" width="4" height="4" rx="1" />
          <path d="M6 10l9-4.5v13L6 14v-4z" />
        </svg>
      );
    case "problem":
      return (
        <svg {...props}>
          <circle cx="12" cy="10" r="6" />
          <line x1="10" y1="20" x2="14" y2="20" />
          <line x1="12" y1="16" x2="12" y2="20" />
        </svg>
      );
  }
}
