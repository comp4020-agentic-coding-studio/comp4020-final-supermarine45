import { Brain, Coffee, Zap, type LucideIcon } from "lucide-react";
import { KUDOS_EMOJI } from "../types";

// Display-only glyph swap for the wire-protocol emoji — the server
// (src/rooms.ts) validates incoming kudos against the literal KUDOS_EMOJI
// strings and spec/kudos-and-stamp.test.ts asserts on them, so the emoji
// values themselves must never change. This map only controls rendering.
export const KUDOS_ICON: Record<(typeof KUDOS_EMOJI)[number], LucideIcon> = {
  "⚡": Zap,
  "☕": Coffee,
  "🧠": Brain,
};
