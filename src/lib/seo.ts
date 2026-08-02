/**
 * docs/08 §4 — every JSON-LD block is built here. Pages never hand-roll schema, so the
 * shapes stay consistent and a fix lands everywhere at once.
 *
 * Returned objects are serialised into a `<script type="application/ld+json">`. Values are
 * JSON-encoded by `JSON.stringify`, which escapes the characters that matter, and no
 * user-supplied HTML is ever placed in a script body.
 */

interface JsonLd {
  '@context': 'https://schema.org';
  '@type': string;
  [key: string]: unknown;
}

export function organizationSchema(origin: string): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'BIOCODE',
    url: origin,
    logo: `${origin}/icon.svg`,
    address: {
      '@type': 'PostalAddress',
      addressLocality: 'Prishtinë',
      addressCountry: 'XK',
    },
  };
}

/** docs/08 §4 — WebSite with SearchAction so the site search can appear in results. */
export function webSiteSchema(origin: string): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'BIOCODE',
    url: origin,
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: `${origin}/search?q={search_term_string}` },
      'query-input': 'required name=search_term_string',
    },
  };
}

export function breadcrumbSchema(origin: string, trail: { name: string; path: string }[]): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((entry, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: entry.name,
      item: `${origin}${entry.path}`,
    })),
  };
}

export function itemListSchema(origin: string, items: { slug: string; name: string }[]): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    numberOfItems: items.length,
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      url: `${origin}/product/${item.slug}`,
      name: item.name,
    })),
  };
}

/**
 * docs/08 §4 — Product with an Offer, and AggregateRating only when there are ratings.
 *
 * Emitting `aggregateRating` with `reviewCount: 0` is a Search Console error, not a neutral
 * absence, so the field is omitted entirely until a product has a review.
 */
export function productSchema(
  origin: string,
  product: {
    slug: string;
    name: string;
    description: string;
    brandName: string;
    sku: string;
    priceCents: number;
    inStock: boolean;
    ratingAvg: number;
    ratingCount: number;
    imageUrl?: string;
  },
): JsonLd {
  const schema: JsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.description,
    sku: product.sku,
    brand: { '@type': 'Brand', name: product.brandName },
    url: `${origin}/product/${product.slug}`,
    offers: {
      '@type': 'Offer',
      // Schema.org wants a decimal string, not cents.
      price: (product.priceCents / 100).toFixed(2),
      priceCurrency: 'EUR',
      availability: product.inStock
        ? 'https://schema.org/InStock'
        : 'https://schema.org/OutOfStock',
      url: `${origin}/product/${product.slug}`,
    },
  };

  if (product.imageUrl) schema.image = product.imageUrl;

  if (product.ratingCount > 0) {
    schema.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: product.ratingAvg.toFixed(1),
      reviewCount: product.ratingCount,
    };
  }

  return schema;
}

export function articleSchema(
  origin: string,
  article: {
    slug: string;
    title: string;
    excerpt: string;
    publishedAt: string | null;
    updatedAt: string;
    authorName?: string;
  },
): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.title,
    description: article.excerpt,
    datePublished: article.publishedAt ?? article.updatedAt,
    dateModified: article.updatedAt,
    author: {
      '@type': article.authorName ? 'Person' : 'Organization',
      name: article.authorName ?? 'BIOCODE',
    },
    publisher: { '@type': 'Organization', name: 'BIOCODE' },
    mainEntityOfPage: `${origin}/knowledge/${article.slug}`,
  };
}

export function faqSchema(entries: { question: string; answer: string }[]): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: entries.map((entry) => ({
      '@type': 'Question',
      name: entry.question,
      acceptedAnswer: { '@type': 'Answer', text: entry.answer },
    })),
  };
}
