import type { TaxonomyKind } from '@/features/catalog/taxonomy-actions';

/**
 * What differs between the four taxonomy screens, declared rather than branched on.
 *
 * The alternative — `{kind === 'goal' && …}` scattered through a shared component — reads fine
 * with two kinds and becomes impossible to audit with four. Here the question "does the goal
 * editor have a tagline?" is answered by looking at one object.
 *
 * Lives outside the client component so the server pages can read the same titles.
 */

export interface ProseField {
  /** Form field prefix — the action reads `${field}Sq` and `${field}En`. */
  field: string;
  label: string;
  help?: string;
  rows?: number;
}

export interface TaxonomyConfig {
  singular: string;
  title: string;
  intro: string;
  /** Bilingual jsonb name, versus brands' plain-text trademark. */
  bilingualName: boolean;
  hasSortOrder: boolean;
  hasIcon: boolean;
  hasParent: boolean;
  hasLogo: boolean;
  hasBrandFields: boolean;
  hasIngredientFields: boolean;
  usageLabel: string;
  prose: ProseField[];
}

export const TAXONOMY_CONFIG: Record<TaxonomyKind, TaxonomyConfig> = {
  brand: {
    singular: 'brand',
    title: 'Brands',
    intro:
      'Every product belongs to exactly one brand, so this list has to exist before the catalogue does.',
    bilingualName: false,
    hasSortOrder: true,
    hasIcon: false,
    hasParent: false,
    hasLogo: true,
    hasBrandFields: true,
    hasIngredientFields: false,
    usageLabel: 'Products',
    prose: [{ field: 'description', label: 'About the brand', rows: 4 }],
  },
  category: {
    singular: 'category',
    title: 'Categories',
    intro:
      'The shop navigation. A product needs a primary category before it can be published, and its breadcrumb comes from here.',
    bilingualName: true,
    hasSortOrder: true,
    hasIcon: true,
    hasParent: true,
    hasLogo: false,
    hasBrandFields: false,
    hasIngredientFields: false,
    usageLabel: 'Products',
    prose: [{ field: 'description', label: 'Description', rows: 3 }],
  },
  goal: {
    singular: 'health goal',
    title: 'Health goals',
    intro:
      'The "shop by goal" tiles — sleep, immunity, energy. A goal is how a customer describes what they want, rather than what the product is.',
    bilingualName: true,
    hasSortOrder: true,
    hasIcon: true,
    hasParent: false,
    hasLogo: false,
    hasBrandFields: false,
    hasIngredientFields: false,
    usageLabel: 'Products',
    prose: [
      {
        field: 'tagline',
        label: 'Tagline',
        help: 'One line, shown under the name on the tile.',
        rows: 2,
      },
      { field: 'description', label: 'Description', rows: 4 },
    ],
  },
  ingredient: {
    singular: 'ingredient',
    title: 'Ingredients',
    intro:
      'The encyclopaedia behind product labels. Everything here is read by customers, so it is subject to the claims rules in docs/08 §7.',
    bilingualName: true,
    hasSortOrder: false,
    hasIcon: false,
    hasParent: false,
    hasLogo: false,
    hasBrandFields: false,
    hasIngredientFields: true,
    usageLabel: 'In products',
    prose: [
      {
        field: 'summary',
        label: 'Summary',
        help: 'Two or three sentences. Shown in the A–Z list.',
        rows: 3,
      },
      {
        field: 'benefits',
        label: 'What it is used for',
        help: 'Describe the role in the body. Never "treats", "cures" or "prevents" — see the reminder below.',
        rows: 4,
      },
      { field: 'dosage', label: 'Typical amounts', rows: 3 },
      {
        field: 'safety',
        label: 'Safety notes',
        help: 'Interactions, who should avoid it, when to ask a doctor.',
        rows: 3,
      },
    ],
  },
};

/**
 * docs/08 §7 — the words that turn a supplement description into an unlicensed medicine claim.
 *
 * Shown as a reminder next to free-text fields that reach customers, not enforced. A blocklist
 * would be trivially defeated by a synonym and would reject legitimate sentences ("does not
 * treat"); the useful thing is that the person writing the sentence has the rule in view.
 */
export const CLAIMS_REMINDER = {
  banned: ['cures', 'treats', 'prevents', 'heals', 'diagnoses', 'guaranteed', 'miracle'],
  guidance:
    'Supplements are food, not medicine. Describe what a nutrient contributes to — "contributes to normal immune function" — never what a condition it fixes.',
} as const;
