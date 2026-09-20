/** Web presentation contracts. These intentionally do not mirror persistence entities. */
export type VerificationState = 'verified' | 'human-reviewed' | 'machine-extracted' | 'unverified';
export type RightsState = 'available' | 'restricted' | 'unavailable';
export interface Citation {
  authorityId: string;
  label: string;
  passageId?: string;
}
export interface Passage {
  id: string;
  documentId: string;
  locator: string;
  text: string;
  version: string;
}
export interface LegalAuthority {
  id: string;
  kind: 'case' | 'legislation';
  title: string;
  identifier: string;
  jurisdiction: string;
  source: string;
  date: string;
  practiceArea: string;
  concept: string;
  excerpt: string;
  verification: VerificationState;
  rights: RightsState;
  version: string;
  demonstration: true;
  scope: 'public-demo';
}
export interface Case extends LegalAuthority {
  kind: 'case';
  judges: string[];
  parties: string[];
  facts: string;
  issues: string;
  holding: string;
  reasoning: string;
  citations: Citation[];
  legislationIds: string[];
  relatedIds: string[];
}
export interface Provision {
  id: string;
  label: string;
  heading: string;
  passageId: string;
}
export interface Legislation extends LegalAuthority {
  kind: 'legislation';
  instrumentNumber: string;
  enactment: string;
  commencement: string;
  status: string;
  parts: { title: string; provisions: Provision[] }[];
  amendments: string[];
  citingCaseIds: string[];
}
export type Authority = Case | Legislation;
export interface SourceReference {
  authority: LegalAuthority;
  documentId: string;
  passageIds: string[];
  passages: Passage[];
}
export interface SearchResult {
  authority: LegalAuthority;
  matchingPassageIds: string[];
}
export interface SearchQuery {
  text: string;
  jurisdiction: string;
  court: string;
  kind: string;
  year: string;
  practiceArea: string;
  concept: string;
}
export type ResearchStatus = 'In progress' | 'Needs review' | 'Draft';

export interface ResearchProject {
  id: string;
  title: string;
  question: string;
  reference: string;
  practiceArea: string;
  /** Court or source placeholder. Always an obviously synthetic "Example …" name. */
  source: string;
  status: ResearchStatus;
  /** ISO timestamp. */
  updated: string;
  authorityIds: string[];
  passageIds: string[];
  note: string;
  history: string[];
}
export interface LegalAnswer {
  answerText: string;
  reasoning: string;
  caveats: string;
  citations: Citation[];
  sourceDocumentIds: string[];
  sourcePassageIds: string[];
  model: string;
  modelVersion: string;
  retrievalIds: string[];
  createdAt: string;
  verification: VerificationState;
  demonstration: true;
}
export interface Alert {
  id: string;
  name: string;
  type: 'Topic' | 'Case' | 'Legislation' | 'Regulatory';
  frequency: 'Daily' | 'Weekly';
  status: 'Active' | 'Paused';
}
export interface UserProfile {
  name: string;
  firstName: string;
  initials: string;
  email: string;
  /** Shown under the name in the sidebar, e.g. "Law Firm". */
  organisationType: string;
}

export interface ActivityMetric {
  id: 'searches' | 'authorities' | 'projects' | 'alerts';
  label: string;
  value: number;
  /** Percentage change against the previous period. Demonstration figure. */
  change: number;
}

export interface ActivityPeriod {
  id: string;
  label: string;
  metrics: ActivityMetric[];
}

export type LegalUpdateCategory =
  'New judgments' | 'Legislation updates' | 'Followed topics' | 'Regulatory updates';

export interface LegalUpdate {
  id: string;
  category: LegalUpdateCategory;
  title: string;
  description: string;
  /** ISO timestamp. */
  at: string;
}

export interface WorkspaceMember {
  name: string;
  role: string;
  email: string;
  status: 'Active' | 'Invited';
}

export interface WorkspaceOverview {
  /** The demonstration clock. Relative times ("2 hours ago") are computed against this. */
  asOf: string;
  profile: UserProfile;
  activity: ActivityPeriod[];
  /** Authorities the user has saved, most recent first. */
  savedAuthorityIds: string[];
  updates: LegalUpdate[];
  members: WorkspaceMember[];
  /** Illustrative role labels. They carry no permissions in this demonstration. */
  roles: { name: string; summary: string }[];
}
