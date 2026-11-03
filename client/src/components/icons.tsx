import type { ReactNode } from "react";
import type { ActivityMode } from "../types";

function IconBase({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  );
}

export function MenuIcon({ className }: { className?: string }) {
  return (
    <IconBase className={className}>
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </IconBase>
  );
}

export function XIcon({ className }: { className?: string }) {
  return (
    <IconBase className={className}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </IconBase>
  );
}

export function LogOutIcon({ className }: { className?: string }) {
  return (
    <IconBase className={className}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </IconBase>
  );
}

export function SunIcon({ className }: { className?: string }) {
  return (
    <IconBase className={className}>
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </IconBase>
  );
}

export function MoonIcon({ className }: { className?: string }) {
  return (
    <IconBase className={className}>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </IconBase>
  );
}

export function MonitorIcon({ className }: { className?: string }) {
  return (
    <IconBase className={className}>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </IconBase>
  );
}

export function ClockIcon({ className }: { className?: string }) {
  return (
    <IconBase className={className}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </IconBase>
  );
}

export function FlameIcon({ className }: { className?: string }) {
  return (
    <IconBase className={className}>
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
    </IconBase>
  );
}

export function CheckIcon({ className }: { className?: string }) {
  return (
    <IconBase className={className}>
      <polyline points="20 6 9 17 4 12" />
    </IconBase>
  );
}

export function AlertTriangleIcon({ className }: { className?: string }) {
  return (
    <IconBase className={className}>
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </IconBase>
  );
}

export function ModeIcon({ mode, className }: { mode: ActivityMode; className?: string }) {
  switch (mode) {
    case "silent":
      return (
        <IconBase className={className}>
          <path d="M4 18v-6a8 8 0 0 1 16 0v6" />
          <rect x="2" y="15" width="4" height="6" rx="1.5" />
          <rect x="18" y="15" width="4" height="6" rx="1.5" />
        </IconBase>
      );
    case "writing":
      return (
        <IconBase className={className}>
          <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
        </IconBase>
      );
    case "pitch":
      return (
        <IconBase className={className}>
          <rect x="2" y="10" width="4" height="4" rx="1" />
          <path d="M6 10l9-4.5v13L6 14v-4z" />
        </IconBase>
      );
    case "problem":
      return (
        <IconBase className={className}>
          <circle cx="12" cy="10" r="6" />
          <line x1="10" y1="20" x2="14" y2="20" />
          <line x1="12" y1="16" x2="12" y2="20" />
        </IconBase>
      );
  }
}
