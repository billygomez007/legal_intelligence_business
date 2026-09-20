/**
 * The one place route paths are defined.
 *
 * Architecture: the public marketing site owns `/` and its siblings; the authenticated research
 * application lives entirely under `/app`. Keeping the app under one prefix gives a single, obvious
 * boundary for the future authentication proxy and stops marketing and app routes colliding.
 */
export const routes = {
  home: '/',
  signIn: '/sign-in',
  getStarted: '/get-started',
  legal: '/legal',

  app: '/app',
  ask: '/app/ask',
  search: '/app/search',
  research: '/app/research',
  library: '/app/library',
  alerts: '/app/alerts',
  organization: '/app/organization',
  settings: '/app/settings',

  researchProject: (id: string) => `/app/research/${id}`,
  case: (id: string, view?: string) => `/app/cases/${id}${view ? `?view=${view}` : ''}`,
  legislation: (id: string, view?: string) =>
    `/app/legislation/${id}${view ? `?view=${view}` : ''}`,
  source: (id: string, passageId?: string) =>
    `/app/sources/${id}${passageId ? `#${passageId}` : ''}`,
} as const;

/** Sections of the public homepage, linked from the navbar and footer. */
export const marketingAnchors = {
  product: '/#product',
  legalIntelligence: '/#legal-intelligence',
  lawFirms: '/#law-firms',
  security: '/#security',
  about: '/#about',
} as const;
