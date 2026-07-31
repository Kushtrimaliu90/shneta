import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

const LEVELS = ['strong', 'moderate', 'emerging', 'traditional'] as const;
type EvidenceLevel = (typeof LEVELS)[number];

function isEvidenceLevel(value: unknown): value is EvidenceLevel {
  return typeof value === 'string' && (LEVELS as readonly string[]).includes(value);
}

/**
 * docs/04 §6 — EvidenceBadge, and docs/08 §7.2: the badge must reflect the honest evidence
 * level rather than flatter the product.
 *
 * The level is spelled out as text, never conveyed by colour alone (docs/04 §10), and the
 * tone deliberately does not run green→red: "traditional" is not a failing grade, it is a
 * different kind of claim, and colouring it as a warning would misrepresent it.
 */
const TONE: Record<EvidenceLevel, string> = {
  strong: 'border-forest-500/40 bg-forest-50 text-forest-800',
  moderate: 'border-forest-500/30 bg-forest-50/70 text-forest-700',
  emerging: 'border-line-strong bg-cream text-ink-600',
  traditional: 'border-line-strong bg-cream text-ink-600',
};

export function EvidenceBadge({
  evidence,
  className,
}: {
  evidence: string | null;
  className?: string;
}) {
  const t = useTranslations('ingredients.evidence');
  if (!isEvidenceLevel(evidence)) return null;

  return (
    <span
      className={cn(
        'rounded-sm border px-1.5 py-0.5 font-ui text-[11px] font-semibold',
        TONE[evidence],
        className,
      )}
    >
      {t(evidence)}
    </span>
  );
}
