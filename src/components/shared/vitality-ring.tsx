import { cn } from '@/lib/utils';

type VitalityRingTone = 'brand' | 'on-dark' | 'on-light';

/**
 * The stroke pairs per ground. `brand` is the device as docs/04 §2 draws it and stays the
 * default everywhere. The other two exist for the submit-button spinner (docs/04 §6), which
 * has to read on both button fills: on forest-800 the brand track disappears into the fill,
 * so the track is white at 25% and the arc steps down to lime-400; on light secondary
 * buttons an 18px lime arc measures under 1.5:1 against the surface, so the arc is
 * forest-700 — the same "contrast in forest, brand in lime" trade the focus ring makes
 * (docs/13 §C).
 */
const TONES: Record<VitalityRingTone, { track: string; arc: string }> = {
  brand: { track: 'var(--color-forest-100)', arc: 'var(--color-lime-500)' },
  'on-dark': {
    track: 'color-mix(in oklab, white 25%, transparent)',
    arc: 'var(--color-lime-400)',
  },
  'on-light': { track: 'var(--color-forest-100)', arc: 'var(--color-forest-700)' },
};

interface VitalityRingProps {
  /** 0–1. The arc fills proportionally. */
  value?: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
  /**
   * Screen-reader label. Omit only when the ring is decorative and the same information is
   * already available as text beside it (docs/04 §10).
   */
  label?: string;
  /** Set false for the navbar mark and other places that must not animate (docs/04 §2). */
  animate?: boolean;
  /** The ground the ring sits on. Default is the brand pair; see `TONES`. */
  tone?: VitalityRingTone;
}

/**
 * docs/04 §2 — BIOCODE's one signature device. Permitted uses are exactly: the loading
 * spinner, the PDP rating arc, routine completeness in the finder and subscription card,
 * and the logo mark backdrop. Restraint everywhere else.
 *
 * Deliberately a **Server Component with a CSS animation**, not Framer Motion. The ring
 * appears above the fold on Home, PLP and PDP; animating it with Framer would put ~40 kB
 * of client JS on the critical path of every one of those routes and blow the 170 kB
 * budget in docs/09 §3 before any product markup exists. The draw-in is identical —
 * `@keyframes vitality-draw` in globals.css, 400 ms, ease-out-quint — and the global
 * `prefers-reduced-motion` rule already neutralises it.
 */
export function VitalityRing({
  value = 1,
  size = 48,
  strokeWidth = 4,
  className,
  label,
  animate = true,
  tone = 'brand',
}: VitalityRingProps) {
  const clamped = Math.min(1, Math.max(0, value));
  const radius = (size - strokeWidth) / 2;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;
  const targetOffset = circumference * (1 - clamped);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn('shrink-0', className)}
      role={label ? 'img' : 'presentation'}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke={TONES[tone].track}
        strokeWidth={strokeWidth}
      />
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke={TONES[tone].arc}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        transform={`rotate(-90 ${center} ${center})`}
        style={{
          strokeDasharray: circumference,
          strokeDashoffset: targetOffset,
          ...(animate
            ? {
                ['--ring-circumference' as string]: `${circumference}`,
                ['--ring-offset-target' as string]: `${targetOffset}`,
                animation: 'vitality-draw var(--duration-page) var(--ease-biocode) both',
              }
            : {}),
        }}
      />
    </svg>
  );
}
