import {
  BadgeCheck,
  Bell,
  Briefcase,
  Database,
  Eye,
  FolderOpen,
  Gavel,
  History,
  Landmark,
  Layers,
  Lock,
  Route,
  ScrollText,
  Search,
  Share2,
  Split,
  Users,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { marketingAnchors, routes } from '../lib/routes';

/**
 * All public-site copy in one typed module, so wording can be reviewed in one place.
 *
 * Copy rules: describe what the platform is designed to do, not what exists. Nothing here claims
 * live coverage, real Ghanaian data, team features, certifications or compliance. The environment is
 * always labelled as a platform preview.
 */

export const previewLabel = 'Platform preview';
export const previewNotice = 'Demonstration environment. Every record shown is synthetic.';

export const navLinks = [
  { label: 'Product', href: marketingAnchors.product },
  { label: 'For Law Firms', href: marketingAnchors.lawFirms },
  { label: 'Legal Intelligence', href: marketingAnchors.legalIntelligence },
  { label: 'Security', href: marketingAnchors.security },
  { label: 'About', href: marketingAnchors.about },
] as const;

export const hero = {
  eyebrow: 'LexGhana · Legal Intelligence',
  headline: 'The intelligence layer for Ghanaian law.',
  message:
    'Research cases, legislation and legal authorities with clarity, provenance and confidence.',
  primary: { label: 'Start researching', href: routes.app },
  secondary: { label: 'Explore the platform', href: marketingAnchors.product },
} as const;

export interface Feature {
  id: string;
  icon: LucideIcon;
  title: string;
  tagline: string;
  description: string;
}

export const productAreas: readonly Feature[] = [
  {
    id: 'legal-research',
    icon: Search,
    title: 'Legal Research',
    tagline: 'Find and explore authorities.',
    description:
      'Search cases, legislation and legal principles in one place, with filters for court, year, practice area and legal concept.',
  },
  {
    id: 'verified-sources',
    icon: BadgeCheck,
    title: 'Verified Sources',
    tagline: 'See provenance and verification.',
    description:
      'Every authority links to its source document, version and review state, so you can check before you rely.',
  },
  {
    id: 'case-intelligence',
    icon: Gavel,
    title: 'Case Intelligence',
    tagline: 'A structured understanding of cases.',
    description:
      'Facts, issues, holding and reasoning are organised into a brief and kept apart from the judgment text itself.',
  },
  {
    id: 'legislation-intelligence',
    icon: Landmark,
    title: 'Legislation Intelligence',
    tagline: 'Navigate statutes and provisions.',
    description:
      'Move through parts and sections, follow amendment history and see which cases cite a provision.',
  },
  {
    id: 'research-workspaces',
    icon: FolderOpen,
    title: 'Research Workspaces',
    tagline: 'Organise matter-based research.',
    description:
      'Keep authorities, source passages and working notes together for each matter, with a place for the report to come.',
  },
  {
    id: 'legal-alerts',
    icon: Bell,
    title: 'Legal Alerts',
    tagline: 'Track topics and future updates.',
    description:
      'Follow topics, cases, legislation and regulatory notices, and choose how often you hear about them.',
  },
];

export const productNote =
  'Shown in the platform preview with synthetic data. Live coverage depends on lawfully licensed sources and is not yet available.';

export const trust = {
  eyebrow: 'Why it is different',
  title: 'Built on the difference between a source and a summary.',
  intro:
    'Most research tools blend what a court said with what a system says about it. LexGhana keeps them apart, on every screen, so you always know what you are reading.',
  principles: [
    {
      icon: ScrollText,
      title: 'Source-grounded research',
      description: 'Answers are designed to point at the passages they rely on, not replace them.',
    },
    {
      icon: Eye,
      title: 'Human-reviewed metadata',
      description:
        'Extracted fields carry a visible review state: machine-extracted, human-reviewed or verified.',
    },
    {
      icon: Route,
      title: 'Clear provenance',
      description:
        'Each record shows where it came from, which version you are reading and its status.',
    },
    {
      icon: Lock,
      title: 'Rights-aware legal data',
      description:
        'What is shown follows what may lawfully be shown. Restricted material is withheld, not disguised.',
    },
    {
      icon: Split,
      title: 'Source and AI synthesis, separated',
      description:
        'Generated text never shares a visual layer with source text. Each has its own colour, label and style.',
    },
  ],
} as const;

export const steps = [
  {
    title: 'Search or ask',
    description: 'Start with a keyword, a citation or a research question in plain language.',
  },
  {
    title: 'Review authorities and source passages',
    description:
      'Open the authorities behind a result, read the source passage and check its review state.',
  },
  {
    title: 'Save research and build your matter',
    description:
      'Keep what matters in a research workspace, with notes and a place for your report.',
  },
] as const;

export const lawFirms = {
  eyebrow: 'For law firms',
  title: 'Research that a whole firm can build on.',
  intro:
    'LexGhana is designed around how firms actually work: many people, many matters, and knowledge that should outlast any one of them.',
  benefits: [
    {
      icon: Zap,
      title: 'Faster research',
      description: 'Get from a question to its authorities in fewer steps.',
    },
    {
      icon: Share2,
      title: 'Shared knowledge',
      description: 'Keep what your team finds where the team can find it.',
    },
    {
      icon: Briefcase,
      title: 'Matter organisation',
      description: 'Group authorities, passages and notes by matter, not by tab.',
    },
    {
      icon: Layers,
      title: 'Authority tracking',
      description: 'See which authorities a matter relies on and how their status changes.',
    },
    {
      icon: History,
      title: 'Institutional memory',
      description: 'Preserve research history so the next lawyer starts from the last one’s work.',
    },
    {
      icon: Users,
      title: 'Controlled team research',
      description: 'Work toward shared workspaces with clear roles rather than shared logins.',
    },
  ],
  note: 'The demonstration workspace shows these ideas with synthetic data. Team accounts, shared libraries and access controls need platform services that are still in development.',
} as const;

export const security = {
  eyebrow: 'Security and trust',
  title: 'Trust is designed in, not added on.',
  intro:
    'These are the principles the platform is being built around. The preview contains public, synthetic data only.',
  items: [
    {
      icon: Route,
      title: 'Source provenance',
      description: 'Records keep their origin, version and identifiers from source to screen.',
    },
    {
      icon: Lock,
      title: 'Rights-aware data handling',
      description:
        'Display follows source rights. Restricted content is withheld rather than summarised.',
    },
    {
      icon: Database,
      title: 'Tenant separation',
      description:
        'Firm data is designed to be separated by tenant, never mixed with the public corpus.',
    },
    {
      icon: Eye,
      title: 'Reviewed legal metadata',
      description:
        'Review state is shown next to every extracted field, so unreviewed data is never mistaken for reviewed data.',
    },
    {
      icon: Split,
      title: 'Clear AI and source separation',
      description:
        'AI-generated text is labelled as such and kept visually apart from primary sources.',
    },
  ],
  note: 'This preview makes no security certification or regulatory compliance claims.',
} as const;

export const about = {
  eyebrow: 'About',
  title: 'Better legal information for a stronger Ghana.',
  body: [
    'LexGhana is being built for the Ghanaian legal profession: to make the law easier to find, read and rely on.',
    'It combines trusted legal sources with modern technology, and it is honest about where each comes from.',
  ],
  disclaimer:
    'LexGhana is a research tool. It does not provide legal advice, and nothing in this preview is a statement of Ghanaian law.',
} as const;

export const finalCta = {
  headline: 'Build stronger legal research with better information.',
  primary: { label: 'Start researching', href: routes.app },
  secondary: { label: 'Explore LexGhana', href: marketingAnchors.product },
} as const;

export const footer = {
  closing: 'Built for the Ghanaian legal profession.',
  tagline: ['Ghanaian Law.', 'Deeper Insight.', 'Greater Impact.'],
  columns: [
    {
      title: 'Product',
      links: [
        { label: 'Legal Research', href: '/#legal-research' },
        { label: 'Verified Sources', href: '/#verified-sources' },
        { label: 'Case Intelligence', href: '/#case-intelligence' },
        { label: 'Legislation Intelligence', href: '/#legislation-intelligence' },
        { label: 'Research Workspaces', href: '/#research-workspaces' },
        { label: 'Legal Alerts', href: '/#legal-alerts' },
      ],
    },
    {
      title: 'Company',
      links: [
        { label: 'About', href: marketingAnchors.about },
        { label: 'For Law Firms', href: marketingAnchors.lawFirms },
        { label: 'Security', href: marketingAnchors.security },
        { label: 'Sign in', href: routes.signIn },
      ],
    },
    {
      title: 'Legal',
      links: [
        { label: 'Legal notice', href: routes.legal },
        { label: 'Not legal advice', href: `${routes.legal}#not-legal-advice` },
        { label: 'Data and sources', href: `${routes.legal}#data-and-sources` },
        { label: 'Privacy and terms', href: `${routes.legal}#privacy-and-terms` },
      ],
    },
    {
      title: 'Resources',
      links: [
        { label: 'Platform preview', href: routes.app },
        { label: 'How it works', href: '/#how-it-works' },
        { label: 'Get started', href: routes.getStarted },
      ],
    },
  ],
} as const;
