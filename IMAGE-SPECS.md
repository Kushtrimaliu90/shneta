# BIOCODE — image sizes for marketing material

Practical reference for anyone producing pictures for the shop. Every pixel size here was **measured on
the live site** at 390 / 768 / 1024 / 1440 / 1920 / 2560 px, not read off a stylesheet.

Related: `docs/04-design-system.md` §7 (imagery), `docs/13-spec-corrections.md` §AV (how these numbers
were audited).

---

## The four you will use most

| Slot                    | Supply          | Shape  | Cropped?                     |
| ----------------------- | --------------- | ------ | ---------------------------- |
| Product photo           | **1600 × 1600** | 1:1    | No — padded                  |
| Hero, desktop           | **2560 × 1600** | 8:5    | **Yes, heavily**             |
| Hero, phone             | **1200 × 675**  | 16:9   | Yes, mildly                  |
| Sponsored banner        | **3200 × 640**  | 5:1    | Yes                          |
| Banner, phone           | **1200 × 600**  | 2:1    | Yes                          |
| Social share (none yet) | **1200 × 630**  | 1.91:1 | Yes, to square in chat lists |

---

## The one rule that decides everything

**`cover`** fills the box and **throws away whatever does not fit**. The hero and the banners work this
way — anything near an edge disappears on some screens.

**`contain`** shrinks the whole picture to fit and pads around it. Every product photo works this way —
nothing is ever cut, but the padding shows, so it must match the background.

---

## Hero photograph

Home page. On desktop it fills the **entire right half** of the window, edge to edge. Uploaded per slide
in `/admin/hero`, with a separate slot for a phone crop.

- **Supply:** 2560 × 1600 (desktop), 1200 × 675 (phone)
- **Behaviour:** `cover` — crops
- **Bucket:** `content`, max 4 MB

| Window | Renders at | Shape | What is visible             |
| ------ | ---------- | ----- | --------------------------- |
| 1024   | 512 × 696  | 0.74  | portrait — taller than wide |
| 1280   | 640 × 496  | 1.29  | landscape                   |
| 1440   | 720 × 596  | 1.21  | landscape                   |
| 1920   | 960 × 776  | 1.24  | landscape                   |
| 2560   | 1280 × 780 | 1.64  | wide landscape              |
| phone  | 348 × 195  | 1.78  | in flow above the copy      |

### ⚠️ The current hero file is the wrong shape and too small

The file in use is **889 × 1197 — portrait**, and the panel is now landscape. Because `cover` fills the
width and discards the surplus height:

| Design                | Visible height |
| --------------------- | -------------- |
| Old 4:5 card          | **93%**        |
| Now, 1280–1920 window | **58–61%**     |
| Now, 2560 window      | **45%**        |

So roughly a third to a half of the picture is gone, which is exactly what was noticed. **Resizing the
same file will not fix it** — the problem is the _aspect ratio_, not the pixel count.

There is a second, separate problem: at 2560 the panel is **1280 CSS px wide**, which is **2560 device
pixels** on a modern laptop or phone screen. The source is 889 px wide, so it is being **upscaled ~1.4×
even at 1×, and ~2.9× on a retina display**. It is the LCP image — the first thing anyone sees — and it
is soft on any large screen no matter how it is cropped.

**One landscape master at 2560 × 1600 fixes both.**

### Hero safe area

Because the panel is portrait on a small laptop and wide landscape on a big monitor, the same file is
cropped differently on every screen. Only a **centred 1050 × 800 region** of a 2560 × 1600 canvas is
guaranteed to be visible everywhere.

```
 2560 x 1600 canvas
 ┌───────────────────────────────────────────┐
 │                                           │  <- lost on wide screens
 │        ┌───────────────────────┐          │
 │        │                       │          │
 │        │   SAFE 1050 x 800     │          │  <- always visible
 │        │                       │          │
 │        └───────────────────────┘          │
 │                                           │  <- lost on wide screens
 └───────────────────────────────────────────┘
      ^                             ^
      lost on narrow screens
```

Keep the product, faces and anything that must survive inside the safe box. Treat the rest as
atmosphere. Also avoid the leftmost ~18% — a soft fade into the page background sits over it.

---

## Product photograph

One square asset per product, reused everywhere from a 356 px card down to a 36 px search suggestion.
This is the workhorse; most production time belongs here.

- **Supply:** 1600 × 1600
- **Behaviour:** `contain` — never cropped, always padded
- **Bucket:** `product-images`, max 2 MB

| Window | Card renders at | Layout                                  |
| ------ | --------------- | --------------------------------------- |
| 390    | 167 × 167       | 2 per row                               |
| 768    | 356 × 356       | 2 per row — the largest it ever renders |
| 1024   | 225 × 225       | 4 per row                               |
| 1440   | 254 × 254       | 5 per row                               |
| 1920   | 244 × 244       | 6 per row                               |
| 2560   | 244 × 244       | 6 per row — the container caps at 1680  |

### Consistency beats resolution here

Nothing is ever cut, but every product sits beside every other — so one photo shot close and another
shot far apart makes a row look untidy however good each one is. Shoot to a fixed rule:

- Subject fills **72% of frame height (±4%)**, optically centred
- Same ground: warm white **`#FAF9F5`**
- One soft shadow, bottom-left, ~12% opacity
- Same white balance throughout (5600K)

### The same file also appears as

| Place                    | Rendered          |
| ------------------------ | ----------------- |
| Product page gallery     | 562 × 562         |
| Cart line                | 80 × 80           |
| Compare table            | 80 × 80           |
| Wishlist and reviews     | 64 × 64           |
| BioHack protocol         | 64 × 64           |
| Knowledge inline product | 56 × 56           |
| Subscription card        | 48 × 48           |
| Search suggestions       | 36 × 36           |
| Category pill (home)     | 44 × 44, circular |

Nothing extra to produce. But note the **44 px circle** on the home page — only the silhouette reads at
that size, so a product whose identity depends on small label text becomes an unrecognisable blob.

---

## Sponsored banner

The wide strip on shop and category pages. Two creatives per placement. Headline and button text are
optional fields that render over a dark scrim on the left, so artwork already carrying its message needs
neither.

- **Supply:** 3200 × 640 (desktop), 1200 × 600 (phone)
- **Behaviour:** `cover` — crops
- **Bucket:** `content`, max 4 MB

| Window         | Renders at | Shape |
| -------------- | ---------- | ----- |
| 390            | 348 × 174  | 2:1   |
| 768            | 726 × 182  | 4:1   |
| 1024           | 971 × 194  | 5:1   |
| 1440           | 1366 × 273 | 5:1   |
| 1920 and above | 1582 × 316 | 5:1   |

One desktop file is stretched across three shapes — 4:1 on a tablet, 5:1 from 1024 up — so top and
bottom get shaved on the wider ones. **Keep type and logos inside the middle 80% of the height.** If you
intend to use the headline and button fields, leave the left third visually quiet.

---

## Slots that exist but are empty

These render placeholders today because nothing has been uploaded. Free wins.

| Slot             | Where        | Shape  | Supply           | Today                                 |
| ---------------- | ------------ | ------ | ---------------- | ------------------------------------- |
| Health goal tile | `/goals`     | 3:2    | 768 × 512        | Green gradient — no row has an image  |
| Article cover    | `/knowledge` | 16:9   | 1600 × 900       | Tinted panel — no article has a cover |
| Brand logo       | `/brands`    | free   | 600 × 300 or SVG | No logo renders at all                |
| **Social share** | every page   | 1.91:1 | **1200 × 630**   | **Missing entirely**                  |

### The social share image is the important one

Paste `biocode.fit` into WhatsApp, Facebook or Viber today and the preview shows a title and a line of
text with **no picture at all** — `openGraph` sets a title and description but no `images`, and no
`opengraph-image` file exists. Next to a competitor's link it reads as broken.

One file at **1200 × 630** fixes it site-wide. Keep text large and central: WhatsApp crops it to a square
thumbnail in chat lists.

---

## What the uploader accepts

Enforced by the storage layer, so an oversized file is refused rather than silently degraded.

| Bucket               | Max size | Formats                        | Used for                             |
| -------------------- | -------- | ------------------------------ | ------------------------------------ |
| `product-images`     | 2 MB     | WebP, JPEG, PNG, AVIF          | Product photography                  |
| `content`            | 4 MB     | WebP, JPEG, PNG, AVIF          | Hero slides, banners, article covers |
| `brand-assets`       | 2 MB     | WebP, JPEG, PNG, AVIF, **SVG** | Brand and merchant logos             |
| `avatars`            | 512 KB   | WebP, JPEG, PNG                | Customer avatars                     |
| `merchant-proposals` | 2 MB     | WebP, JPEG, PNG, AVIF          | Seller-submitted photos (private)    |

Delivery is **WebP only**, generated automatically at the widths the layout needs, and capped at
**1920 px wide**. So:

- You never need to upload WebP yourself — a high-quality JPEG or PNG is a better master.
- There is no benefit to supplying anything wider than the numbers on this page.

---

## Logo files that already exist

Production-ready, shipped with the site. Vectors in `public/brand/`, raster exports in
`public/brand/png/`.

| File                | Size        | Use                                            |
| ------------------- | ----------- | ---------------------------------------------- |
| `primary-2400.png`  | 2400 wide   | Main horizontal logo, light backgrounds        |
| `reverse-2400.png`  | 2400 wide   | Same logo for dark backgrounds                 |
| `stacked-1600.png`  | 1600 wide   | Vertical lockup, narrow spaces                 |
| `mark-1024.png`     | 1024 × 1024 | The ring mark alone                            |
| `app-icon-1024.png` | 1024 × 1024 | App and profile pictures                       |
| `*.svg`             | vector      | Print, signage, anything scaled — prefer these |

Clear-space, minimum-size and never-recolour rules are in `public/brand/USAGE.md`. Give printers the
**SVG** unless they insist on raster.

---

## If you only produce three things

1. **A social share image, 1200 × 630.** Missing entirely, and it represents the whole shop every time
   someone sends a link.
2. **A landscape hero, 2560 × 1600.** The current one is a portrait shot being centre-cropped into a wide
   panel, and it is upscaled on any large screen.
3. **Consistent product photography to one fixed rule.** More visible than any layout change, because
   two dozen sit side by side and every inconsistency compounds.

## Two habits worth keeping

- **Design for the crop, not the canvas.** Anything `cover` loses its edges on some screen. The safe area
  is the real canvas.
- **Master big, upload once.** Delivery is capped at 1920 px and re-encoded automatically, so a good
  master at the sizes above is all the site will ever need.
