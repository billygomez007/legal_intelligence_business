import { FileText, Gavel, Landmark, Newspaper, ScrollText, type LucideIcon } from 'lucide-react';

export interface ResearchScope {
  value: string;
  label: string;
  icon: LucideIcon;
}

/** The kinds of material a research question can be scoped to. Shared by the dashboard and Ask. */
export const researchScopes: readonly ResearchScope[] = [
  { value: 'cases', label: 'Cases', icon: FileText },
  { value: 'legislation', label: 'Legislation', icon: Landmark },
  { value: 'principles', label: 'Legal principles', icon: Gavel },
  { value: 'procedure', label: 'Procedural rules', icon: ScrollText },
  { value: 'developments', label: 'Recent developments', icon: Newspaper },
];
