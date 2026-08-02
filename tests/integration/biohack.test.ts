import { beforeAll, describe, expect, it } from 'vitest';
import { anonClient, serviceClient } from './helpers';
import { loadConfig } from '@/features/biohack/config-mapper';
import { generateProtocol } from '@/features/biohack/engine';
import type { CatalogProduct, ProtocolConfig, ProtocolInputs } from '@/features/biohack/types';

/**
 * docs/15 §7 — the seeded config against the real database.
 *
 * The unit suite proves the engine's rules with hand-written fixtures. This proves the other
 * half, which fixtures cannot: that the **shipped config** is complete, that its copy survives
 * the jsonb round trip, and that the RLS on the config tables actually holds.
 *
 * The centrepiece is docs/15's definition of done, run for real: sleep + stress, vegan, no
 * caffeine, and everything that sentence promises about the result.
 */

let config: ProtocolConfig;
let catalog: CatalogProduct[];

function answers(over: Partial<ProtocolInputs> = {}): ProtocolInputs {
  return {
    goals: ['gjumi'],
    diet: 'pa_kufizime',
    caffeine: 'po',
    restrictedLifeStage: false,
    medication: false,
    level: 'i_avancuar',
    budgetCents: null,
    ...over,
  };
}

/**
 * The same shape `config-loader` builds, assembled here with the service client.
 *
 * Duplicated rather than imported because the loader is `server-only` and wraps everything in
 * `unstable_cache`, neither of which exists in this process. The *mapping* is the part that
 * matters and that is imported — only the catalogue query is repeated.
 */
async function readCatalog(): Promise<CatalogProduct[]> {
  const db = serviceClient();

  const { data } = await db
    .from('products')
    .select(
      `id, slug, dietary_tags, rating_avg, is_featured, serving_size,
       product_ingredients ( ingredients ( slug ) ),
       product_variants ( id, price_cents, is_default, is_active )`,
    )
    .eq('status', 'published')
    .is('deleted_at', null);

  const { data: stock } = await db.from('v_product_stock').select('variant_id, is_available');
  const available = new Set(
    ((stock ?? []) as { variant_id: string; is_available: boolean }[])
      .filter((s) => s.is_available)
      .map((s) => s.variant_id),
  );

  type Raw = {
    id: string;
    slug: string;
    dietary_tags: string[] | null;
    rating_avg: number | null;
    is_featured: boolean;
    serving_size: string | null;
    product_ingredients: { ingredients: { slug: string } | null }[];
    product_variants: { id: string; price_cents: number; is_default: boolean; is_active: boolean }[];
  };

  return ((data ?? []) as unknown as Raw[]).flatMap((row) => {
    const active = (row.product_variants ?? []).filter((v) => v.is_active);
    const variant = active.find((v) => v.is_default) ?? active[0];
    if (!variant) return [];
    const servings = Number.parseInt(row.serving_size ?? '', 10);
    return [
      {
        productId: row.id,
        slug: row.slug,
        variantId: variant.id,
        ingredientSlugs: (row.product_ingredients ?? [])
          .map((pi) => pi.ingredients?.slug)
          .filter((s): s is string => Boolean(s)),
        dietaryTags: row.dietary_tags ?? [],
        priceCents: variant.price_cents,
        pricePerServingCents:
          Number.isFinite(servings) && servings > 0
            ? Math.round(variant.price_cents / servings)
            : variant.price_cents,
        ratingAvg: row.rating_avg ?? 0,
        isFeatured: row.is_featured,
        inStock: available.has(variant.id),
      },
    ];
  });
}

beforeAll(async () => {
  const loaded = await loadConfig(serviceClient());
  if (!loaded) throw new Error('no approved protocol config — migration 22 has not been applied');
  config = loaded;
  catalog = await readCatalog();
});

describe('the shipped config is complete (docs/15 §5)', () => {
  it('is an approved version with blocks for every goal', async () => {
    const { data: goals } = await serviceClient().from('health_goals').select('slug');
    const slugs = (goals ?? []).map((g) => g.slug);

    for (const slug of slugs) {
      const forGoal = config.blocks.filter((b) => b.goalSlug === slug && b.active);
      expect(forGoal.length, `${slug} needs at least three blocks`).toBeGreaterThanOrEqual(3);
      expect(forGoal.some((b) => b.isCore), `${slug} needs a core block`).toBe(true);
    }
  });

  it('every block carries PSE copy in both locales', () => {
    for (const b of config.blocks) {
      expect(b.why.sq.length, `${b.goalSlug}/${b.ingredientSlug ?? 'habit'} sq`).toBeGreaterThan(10);
      expect(b.why.en.length, `${b.goalSlug}/${b.ingredientSlug ?? 'habit'} en`).toBeGreaterThan(10);
    }
  });

  /**
   * docs/08 §7 — the claim-language floor, asserted rather than reviewed.
   *
   * This copy reaches customers as the reason a supplement is in their protocol, which makes it a
   * health claim. A banned verb here is a regulatory problem, not a tone problem, so it fails the
   * build instead of waiting for someone to read fifty rows.
   */
  it('no PSE or caution copy uses a banned verb', () => {
    const banned = /\b(cure[sd]?|treat(s|ed|ment)?|prevent(s|ed)?|heal(s|ed)?|diagnos|kuron|mjekon|parandalon|shëron)\b/i;

    for (const b of config.blocks) {
      for (const [locale, text] of [['sq', b.why.sq], ['en', b.why.en]] as const) {
        expect(banned.test(text), `${b.goalSlug}/${b.ingredientSlug ?? 'habit'} ${locale}: "${text}"`)
          .toBe(false);
      }
      if (b.caution) {
        expect(banned.test(b.caution.sq + ' ' + b.caution.en), 'caution copy').toBe(false);
      }
    }
  });

  it('every goal has metric templates in both locales', () => {
    for (const slug of Object.keys(config.metrics)) {
      expect(config.metrics[slug]?.sq.length, `${slug} sq metrics`).toBeGreaterThan(0);
      expect(config.metrics[slug]?.en.length, `${slug} en metrics`).toBeGreaterThan(0);
    }
    expect(Object.keys(config.metrics).length).toBe(16);
  });
});

describe('docs/15 definition of done, against real data', () => {
  it('sleep + stress, vegan, no caffeine produces a real protocol', () => {
    const result = generateProtocol(
      config,
      catalog,
      answers({ goals: ['gjumi', 'stresi'], diet: 'vegan', caffeine: 'jo' }),
    );

    expect(result.gated).toBe(false);
    expect(result.items.length, 'between the configured min and max').toBeGreaterThanOrEqual(2);
    expect(result.items.length).toBeLessThanOrEqual(config.settings.maxItems);

    // Both goals represented — the per-goal guarantee, end to end.
    for (const goal of ['gjumi', 'stresi']) {
      expect(
        result.items.some((i) => i.goalSlugs.includes(goal)),
        `${goal} must be represented`,
      ).toBe(true);
    }
  });

  it('magnesium appears once, carrying both goals in its PSE line', () => {
    const result = generateProtocol(
      config,
      catalog,
      answers({ goals: ['gjumi', 'stresi'], diet: 'vegan', caffeine: 'jo' }),
    );

    const magnesium = result.items.filter((i) => i.key === 'magnesium');
    expect(magnesium, 'exactly one magnesium item, not one per goal').toHaveLength(1);
    expect(magnesium[0]?.goalSlugs.sort()).toEqual(['gjumi', 'stresi']);
    expect(magnesium[0]?.score, 'the two weights summed').toBe(165);
  });

  it('every purchasable item has a live price and a real variant', () => {
    const result = generateProtocol(config, catalog, answers({ goals: ['gjumi', 'stresi'] }));

    for (const item of result.items) {
      if (item.kind === 'habit' || item.comingSoon) continue;
      expect(item.product, `${item.key} must resolve`).not.toBeNull();
      expect(item.product?.priceCents).toBeGreaterThan(0);
      expect(item.product?.variantId).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it('a vegan is never handed a non-vegan product', () => {
    const result = generateProtocol(
      config,
      catalog,
      answers({ goals: ['gjumi', 'stresi', 'imuniteti'], diet: 'vegan' }),
    );

    for (const item of result.items) {
      if (!item.product) continue;
      const source = catalog.find((p) => p.productId === item.product?.productId);
      expect(source?.dietaryTags, `${item.key}`).toContain('vegan');
    }
  });

  it('medication removes every med-sensitive ingredient from the result', () => {
    const sensitive = config.blocks.filter((b) => b.medSensitive).map((b) => b.ingredientSlug);
    expect(sensitive.length, 'the seed flags some').toBeGreaterThan(0);

    const result = generateProtocol(
      config,
      catalog,
      answers({ goals: ['stresi', 'gjumi'], medication: true }),
    );

    for (const item of result.items) {
      expect(sensitive, `${item.key} is med-sensitive and must be gone`).not.toContain(item.key);
    }
    expect(result.medicationCaution).toBe(true);
  });

  it('the gate returns nothing purchasable', () => {
    const result = generateProtocol(
      config,
      catalog,
      answers({ goals: ['gjumi'], restrictedLifeStage: true }),
    );

    expect(result.gated).toBe(true);
    expect(result.items).toHaveLength(0);
    expect(result.monthlyTotalCents).toBe(0);
  });

  it('melatonin, if recommended, is confined to before bed by the seeded rule', () => {
    const result = generateProtocol(config, catalog, answers({ goals: ['gjumi'] }));
    const melatonin = result.items.find((i) => i.key === 'melatonin');

    // Not always selected — it is phase 2 and mid-weight. Assert the rule only when it appears.
    if (melatonin) expect(melatonin.timing).toEqual(['para_gjumit']);
  });

  it('produces the same protocol twice for the same answers', () => {
    const input = answers({ goals: ['energji', 'truri'], level: 'fillestar' });
    const a = generateProtocol(config, catalog, input);
    const b = generateProtocol(config, catalog, input);

    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('every one of the sixteen goals generates something on its own', () => {
    for (const slug of Object.keys(config.metrics)) {
      const result = generateProtocol(config, catalog, answers({ goals: [slug] }));
      expect(result.items.length, `${slug} produced nothing`).toBeGreaterThan(0);
    }
  });
});

describe('RLS on the config tables (docs/15 §2)', () => {
  it('an anonymous visitor cannot read the ruleset', async () => {
    const anon = anonClient();

    for (const table of ['protocol_configs', 'protocol_blocks', 'protocol_conflicts'] as const) {
      const { data } = await anon.from(table).select('id');
      expect(data ?? [], `${table} must be invisible to anon`).toHaveLength(0);
    }
  });

  it('an anonymous visitor cannot read other people’s generated protocols', async () => {
    const { data } = await anonClient().from('generated_protocols').select('id');
    expect(data ?? []).toHaveLength(0);
  });

  it('the share RPC returns the result and nothing identifying', async () => {
    const db = serviceClient();
    const code = `test-${Math.random().toString(36).slice(2, 10)}`;

    await db.from('generated_protocols').insert({
      share_code: code,
      user_id: null,
      config_version: config.version,
      inputs: { goals: ['gjumi'], secret: 'must-not-leak' },
      result: { items: [], disclaimer: true },
    });

    const { data } = await anonClient().rpc('get_shared_protocol', { p_code: code });

    expect(data, 'the result is returned').toEqual({ items: [], disclaimer: true });
    expect(JSON.stringify(data), 'the inputs are not').not.toContain('must-not-leak');

    await db.from('generated_protocols').delete().eq('share_code', code);
  });
});
