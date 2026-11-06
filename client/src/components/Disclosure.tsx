import { useState } from "react";
import { ChevronRight } from "lucide-react";

export function Disclosure({
  label,
  defaultOpen = false,
  children,
}: {
  label: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-ink-muted"
        aria-expanded={open}
      >
        <ChevronRight
          size={14}
          strokeWidth={1.5}
          className={`transition-transform duration-150 ${open ? "rotate-90" : ""}`}
        />
        {label}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}
