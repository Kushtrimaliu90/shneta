/**
 * docs/17 §7 — the referral email copy, in both locales.
 *
 * ── Why this is its own module ──
 *
 * It was inside `email.ts`, which starts with `import 'server-only'` — and the unit suite deliberately
 * does not stub that (docs/13 §X5): the integration config's note says a unit test reaching for a
 * server-only module is a sign the module boundary is wrong. It was right. This table is strings. It
 * needs no client, no environment and no provider, and the test that holds docs/17 §0.2's rule against it
 * should not have to pretend to be a server to read it.
 *
 * ── The rule every string here obeys ──
 *
 * **Nothing about the referred customer's shopping.** Not an amount, not an order, not a date. Every
 * other guard in this feature stops *data* reaching a referrer — the missing RLS policy, the RPC that
 * returns a month instead of a date, the ledger row with no `order_id`. None of them stops a *sentence*.
 * `tests/unit/referral-email-copy.test.ts` is what does, by allowlisting the placeholders this feature
 * has data for at all.
 */
export const COPY = {
  sq: {
    monthlySubject: 'Pikët e ftesave për {period}',
    monthlyHeading: 'Pikët e tua nga ftesat',
    monthlyIntro:
      'Shtuam {points} pikë në llogarinë tënde për {period} — nga porositë e shokëve që ftove. Vlejnë {value}.',
    monthlyNegativeIntro:
      'Korrigjuam pikët e ftesave për {period} me {points} pikë, sepse një porosi u kthye.',
    expirySubject: 'Ftesa jote përfundon pas {days} ditësh',
    expiryHeading: 'Një ftesë po përfundon',
    expiryIntro:
      'Një nga ftesat e tua përfundon pas {days} ditësh, më {date}. Deri atëherë vazhdon të fitosh pikë nga porositë e tij. Kjo ftesë të ka dhënë {points} pikë deri tani.',
    expiryTail:
      'Pas kësaj date ftesa mbaron dhe nuk fiton më pikë nga ajo. Pikët që ke fituar mbeten të tuat.',

    joinedSubject: 'Dikush përdori kodin tënd',
    joinedHeading: 'Kodi i juaji u përdor',
    joinedIntro: '{name} u regjistrua me kodin tënd të ftesës. Faleminderit që e përhape fjalën.',
    joinedTail:
      'Po e kontrollojmë ftesën. Sapo miratohet, fillon të fitosh pikë nga porositë e tij për 12 muaj.',

    approvedSubject: 'Ftesa jote u miratua',
    approvedHeading: 'Ftesa u miratua',
    approvedIntro:
      'Ftesa për {name} u miratua. Për 12 muajt e ardhshëm fiton pikë nga porositë e tij.',
    approvedTail:
      'Pikët shtohen një herë në muaj. Nuk shohim nevojë të bëjmë asgjë tjetër — vetëm vazhdo t’i ftosh.',

    revokedSubject: 'Një ftesë u ndal',
    revokedHeading: 'Një ftesë u ndal',
    revokedIntro: 'Ndalëm një nga ftesat e tua, ndaj nga ajo nuk fitohen më pikë të reja.',
    revokedTail:
      'Pikët që ke fituar deri tani mbeten të tuat. Nëse ky vendim nuk të duket i drejtë, shkruaji shërbimit të klientit.',

    welcomeSubject: 'U regjistruat me kodin e një shoku',
    welcomeHeading: 'Mirë se vini në BIOCODE',
    welcomeIntro:
      'Regjistrimin tuaj e lidhëm me kodin e ftesës nga {name}. Për ju nuk ndryshon asgjë: çmimet dhe porositë janë të njëjta.',
    welcomeTail:
      'Shoku juaj fiton pikë nga porositë tuaja për 12 muaj. Ai shikon vetëm emrin tuaj të parë dhe shkronjën e mbiemrit — as çka blini, as sa shpenzoni.',
    readTerms: 'Lexo kushtet e ftesave',

    view: 'Shiko ftesat e tua',
    footer: 'E merr këtë email sepse ke ftuar dikë te BIOCODE.',
    footerRevoked: 'E merr këtë email sepse ke ftuar dikë te BIOCODE.',
    footerReferee: 'E merr këtë email sepse u regjistruat te BIOCODE me kodin e një shoku.',
  },
  en: {
    monthlySubject: 'Your referral points for {period}',
    monthlyHeading: 'Your referral points',
    monthlyIntro:
      'We added {points} points to your account for {period}, from orders by friends you invited. They are worth {value}.',
    monthlyNegativeIntro:
      'We adjusted your referral points for {period} by {points} points, because an order was returned.',
    expirySubject: 'One of your invites ends in {days} days',
    expiryHeading: 'An invite is ending',
    expiryIntro:
      'One of your invites ends in {days} days, on {date}. Until then you keep earning points from their orders. This invite has earned you {points} points so far.',
    expiryTail:
      'After that date the invite finishes and stops earning. The points you have already earned stay yours.',

    joinedSubject: 'Somebody used your code',
    joinedHeading: 'Your code was used',
    joinedIntro: '{name} registered with your invite code. Thank you for spreading the word.',
    joinedTail:
      'We are reviewing the invite. Once it is approved you start earning points from their orders for 12 months.',

    approvedSubject: 'Your invite was approved',
    approvedHeading: 'Invite approved',
    approvedIntro:
      'The invite for {name} has been approved. For the next 12 months you earn points from their orders.',
    approvedTail:
      'Points are added once a month. There is nothing else to do — just keep inviting.',

    revokedSubject: 'An invite was stopped',
    revokedHeading: 'An invite was stopped',
    revokedIntro: 'We have stopped one of your invites, so it no longer earns new points.',
    revokedTail:
      'The points you have already earned stay yours. If this does not look right, write to customer service.',

    welcomeSubject: "You joined with a friend's code",
    welcomeHeading: 'Welcome to BIOCODE',
    welcomeIntro:
      'We recorded your sign-up against an invite code from {name}. Nothing changes for you: the prices and your orders are the same.',
    welcomeTail:
      'Your friend earns points from your orders for 12 months. They see only your first name and a surname initial — not what you buy, and not what you spend.',
    readTerms: 'Read the referral terms',

    view: 'See your invites',
    footer: 'You are receiving this because you invited somebody to BIOCODE.',
    footerRevoked: 'You are receiving this because you invited somebody to BIOCODE.',
    footerReferee: "You are receiving this because you signed up to BIOCODE with a friend's code.",
  },
} as const;
