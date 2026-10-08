/*
 * Adapted from AstroWind src/navigation.ts
 * https://github.com/onwidget/astrowind/blob/14e1a691f80548dcc36370847b1a02c0d0b12821/src/navigation.ts
 * MIT License, Copyright (c) 2023 onWidget. See CREDITS.md.
 *
 * Shapes kept: headerData { links, actions }, footerData { links, secondaryLinks, footNote }.
 * Routes below are FROZEN (plan T1). Category mapping is provisional until the client confirms.
 * /pricing (US-017) is linked only when PRICING_LIVE (always in staging; in launch once prices exist).
 */
import { CONTACT, CTA, LAUNCH, getQuoteHref } from "./lib/config";
import { PRICING_LIVE } from "./lib/pricing";

const pricingLink: NavLink[] = PRICING_LIVE
  ? [{ text: "Pricing", href: "/pricing" }]
  : [];

export interface NavLink {
  text: string;
  href: string;
  /** Child links (Products mega panel: categories, each with its models). */
  links?: NavLink[];
}

export interface NavAction {
  text: string;
  href: string;
  variant: "primary" | "secondary" | "link";
  icon?: "phone" | "mail";
  ariaLabel?: string;
}

export interface FooterColumn {
  title: string;
  links: NavLink[];
}

/** Normalises a pathname for comparison: strips .html, /index and trailing slashes. */
export function cleanPath(pathname: string): string {
  const p = pathname
    .replace(/\.html$/, "")
    .replace(/\/index$/, "/")
    .replace(/\/+$/, "");
  return p === "" ? "/" : p;
}

/** Provisional mapping, client to confirm (docs/client-questions.md). */
export const productCategories: NavLink[] = [
  {
    text: "Residential silencers",
    href: "/products/residential",
    links: [
      { text: "SEA", href: "/products/sea" },
      { text: "SE30", href: "/products/se30" },
      { text: "SE30 ABS", href: "/products/se30-abs" },
      { text: "SE40", href: "/products/se40" },
    ],
  },
  {
    text: "Critical silencers",
    href: "/products/critical",
    links: [{ text: "SE50", href: "/products/se50" }],
  },
  {
    text: "Industrial silencers",
    href: "/products/industrial",
    links: [
      { text: "SLS", href: "/products/sls" },
      { text: "SE20", href: "/products/se20" },
    ],
  },
  {
    text: "Spark arrestors",
    href: "/products/spark-arrestors",
    links: [
      { text: "SA1", href: "/products/sa1" },
      { text: "SA2", href: "/products/sa2" },
    ],
  },
];

export const headerData: { links: NavLink[]; actions: NavAction[] } = {
  links: [
    { text: "Products", href: "/products", links: productCategories },
    ...pricingLink,
    { text: "Projects", href: "/projects" },
    { text: "About", href: "/about" },
    { text: "Contact", href: "/contact" },
  ],
  actions: [
    {
      text: CONTACT.phoneDisplay,
      href: CONTACT.phoneHref,
      variant: "link",
      icon: "phone",
      ariaLabel: `Call ${CONTACT.phoneDisplay}`,
    },
    { text: CTA.quoteLabel, href: getQuoteHref(), variant: "primary" },
  ],
};

export const footerData: {
  links: FooterColumn[];
  secondaryLinks: NavLink[];
  footNote: string;
} = {
  links: [
    {
      title: "Products",
      links: [
        { text: "All products", href: "/products" },
        ...productCategories.map(({ text, href }) => ({ text, href })),
        ...pricingLink,
      ],
    },
    {
      title: "Company",
      links: [
        { text: "Home", href: "/" },
        { text: "Projects", href: "/projects" },
        { text: "About", href: "/about" },
        { text: "Contact", href: "/contact" },
      ],
    },
  ],
  secondaryLinks: [
    { text: "Privacy policy", href: "/privacy" },
    { text: "Terms and conditions", href: "/terms" },
    { text: "Cookie policy", href: "/cookies" },
  ],
  // Staging only until Peco supplies the company number; launch omits it.
  footNote: LAUNCH ? "" : "Company no. TODO(client)",
};
