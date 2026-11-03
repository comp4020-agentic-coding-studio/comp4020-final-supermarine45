function monogram(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function hueFor(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const hue = hueFor(name);
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-mono font-semibold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        background: `hsl(${hue} 45% 32%)`,
      }}
      aria-hidden="true"
    >
      {monogram(name)}
    </div>
  );
}
