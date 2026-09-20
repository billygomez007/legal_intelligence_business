import { BookOpen, FileText, Landmark, Network } from 'lucide-react';
import { AskLawHero } from '../../components/dashboard/ask-law-hero';
import { BrandCallout } from '../../components/dashboard/brand-callout';
import { LegalUpdatesPanel } from '../../components/dashboard/legal-updates-panel';
import { type QuickAction, QuickActions } from '../../components/dashboard/quick-actions';
import { RecentResearchPanel } from '../../components/dashboard/recent-research-panel';
import { ResearchActivityPanel } from '../../components/dashboard/activity-panel';
import { SavedAuthoritiesPanel } from '../../components/dashboard/saved-authorities-panel';
import { WelcomeHeader } from '../../components/dashboard/welcome-header';
import { authorityHref } from '../../components/legal';
import { webClients } from '../../data/mock-clients';
import { routes } from '../../lib/routes';

export const metadata = { title: 'Dashboard' };

export default async function Dashboard() {
  const [projects, authorities, workspace] = await Promise.all([
    webClients.research.list(),
    webClients.authorities.list(),
    webClients.workspace.overview(),
  ]);
  const saved = workspace.savedAuthorityIds
    .map((id) => authorities.find((authority) => authority.id === id))
    .filter((authority) => authority !== undefined);
  const first = saved[0];

  const iconProps = { size: 22, strokeWidth: 1.5, 'aria-hidden': true } as const;
  const actions: QuickAction[] = [
    {
      href: `${routes.search}?kind=case`,
      title: 'Find cases',
      description: 'Search case law by topic or citation',
      icon: <FileText {...iconProps} />,
    },
    {
      href: `${routes.search}?kind=legislation`,
      title: 'Search legislation',
      description: 'Browse Acts and instruments',
      icon: <Landmark {...iconProps} />,
    },
    {
      href: `${routes.ask}?intent=proposition`,
      title: 'Find authority',
      description: 'Look for support for a proposition',
      icon: <BookOpen {...iconProps} />,
    },
    {
      href: first ? `${authorityHref(first)}?view=related` : routes.search,
      title: 'Explore related',
      description: 'See how authorities connect',
      icon: <Network {...iconProps} />,
    },
  ];

  return (
    <>
      <WelcomeHeader firstName={workspace.profile.firstName} />
      <div className="dashboard">
        <AskLawHero />
        <ResearchActivityPanel periods={workspace.activity} />
        <QuickActions actions={actions} href={routes.search} />
        <RecentResearchPanel projects={projects.slice(0, 4)} asOf={workspace.asOf} />
        <SavedAuthoritiesPanel authorities={saved.slice(0, 4)} />
        <LegalUpdatesPanel updates={workspace.updates} asOf={workspace.asOf} />
        <BrandCallout />
      </div>
    </>
  );
}
