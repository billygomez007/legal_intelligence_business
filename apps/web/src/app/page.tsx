import Link from 'next/link';
import { ArrowRight, BookOpen, FileText, FolderOpen, Search, ShieldCheck } from 'lucide-react';
import { webClients } from '../data/mock-clients';
import { AuthorityCard } from '../components/legal';
import { EmptyState, PageHeader, SectionHeading } from '../components/ui/primitives';
export default async function Dashboard() {
  const [projects, authorities, workspace] = await Promise.all([
    webClients.research.list(),
    webClients.authorities.list(),
    webClients.workspace.overview(),
  ]);
  const shortcuts = [
    { label: 'Find cases', href: '/search?kind=case' },
    { label: 'Search legislation', href: '/search?kind=legislation' },
    { label: 'Authority for a proposition', href: '/ask?intent=proposition' },
    { label: 'Explore similar cases', href: '/cases/sample-contract?view=related' },
    { label: 'Check case treatment', href: '/cases/sample-contract?view=citations' },
  ];
  return (
    <>
      <PageHeader
        eyebrow="YOUR RESEARCH WORKSPACE"
        title="A clearer view of the law."
        description="Find authorities, follow developments and bring your research together."
        action={
          <Link className="button secondary" href="/research">
            <FolderOpen size={15} aria-hidden="true" />
            Open research
          </Link>
        }
      />
      <section className="research-box" aria-labelledby="ask-heading">
        <h2 id="ask-heading">Ask Ghanaian Law</h2>
        <p>Search cases, legislation and verified legal authorities.</p>
        <form action="/ask">
          <label className="sr-only" htmlFor="dashboard-question">
            Legal research question
          </label>
          <div className="research-input">
            <Search size={19} aria-hidden="true" />
            <input
              id="dashboard-question"
              name="q"
              placeholder="Ask a legal research question..."
              maxLength={1500}
            />
            <button className="button" type="submit">
              Start research <ArrowRight size={15} aria-hidden="true" />
            </button>
          </div>
        </form>
        <div className="research-bottom">
          <span>Ghana jurisdiction · Public corpus preview</span>
          <span>Interface preview. AI research is not connected.</span>
        </div>
      </section>
      <div className="shortcuts" aria-label="Research shortcuts">
        {shortcuts.map(({ label, href }) => (
          <Link className="shortcut" key={label} href={href}>
            <BookOpen size={12} aria-hidden="true" />
            {label}
          </Link>
        ))}
      </div>
      <div className="dashboard-grid">
        <div>
          <section>
            <SectionHeading title="Recent research" href="/research" />
            <div className="panel">
              {projects.length ? (
                projects.map((project) => (
                  <Link key={project.id} className="recent-row" href={`/research/${project.id}`}>
                    <span className="document-icon">
                      <FolderOpen size={17} aria-hidden="true" />
                    </span>
                    <div>
                      <h3>{project.title}</h3>
                      <p className="micro">
                        {project.reference} · {project.authorityIds.length} authorities ·
                        Demonstration
                      </p>
                    </div>
                    <time dateTime={project.updated}>{project.updated}</time>
                  </Link>
                ))
              ) : (
                <EmptyState />
              )}
            </div>
          </section>
          <section className="saved-section">
            <SectionHeading title="Saved authorities" href="/library" />
            <p className="micro mb-3">
              Example matter: Sample Contract Dispute · Demonstration collection
            </p>
            <div className="panel">
              {authorities
                .filter((a) => projects[0]?.authorityIds.includes(a.id))
                .map((authority) => (
                  <AuthorityCard key={authority.id} authority={authority} />
                ))}
            </div>
          </section>
        </div>
        <aside className="dashboard-rail">
          <section>
            <SectionHeading title="Legal updates" href="/alerts" link="Manage" />
            <div className="updates-list">
              {workspace.updates.map((update) => (
                <article className="update-item" key={update.title}>
                  <p className="eyebrow">{update.category} · demo</p>
                  <h3>{update.title}</h3>
                  <p>{update.description}</p>
                </article>
              ))}
            </div>
            <p className="micro mt-3">Illustrative updates, not real legal developments.</p>
          </section>
          <section className="trust-note">
            <ShieldCheck size={24} strokeWidth={1.5} aria-hidden="true" />
            <h3>Confidence starts at the source.</h3>
            <p>
              Open the underlying passage, check its provenance and keep your own research notes.
            </p>
            <Link className="text-link mt-4" href="/sources/sample-contract">
              <FileText size={13} aria-hidden="true" />
              Explore a demonstration source
            </Link>
          </section>
        </aside>
      </div>
    </>
  );
}
