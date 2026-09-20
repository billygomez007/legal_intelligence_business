export const metadata = { title: 'Legal notice' };

export default function LegalNoticePage() {
  return (
    <article className="m-standalone m-legal">
      <p className="eyebrow">Legal notice</p>
      <h1>What this preview is, and is not.</h1>
      <section id="not-legal-advice" className="m-prose">
        <h2>Not legal advice</h2>
        <p>
          LexGhana is a legal research tool preview. It does not provide legal advice, and nothing
          in it is a statement of Ghanaian law. Always consult the original sources and a qualified
          lawyer before relying on any research.
        </p>
      </section>
      <section id="data-and-sources" className="m-prose">
        <h2>Data and sources</h2>
        <p>
          Every record in this environment is synthetic. Titles, identifiers, courts and passages
          are invented for demonstration, and none is a real judgment, statute or citation.
          Verification and rights badges are illustrations and carry a “demo” suffix for that
          reason.
        </p>
      </section>
      <section id="privacy-and-terms" className="m-prose">
        <h2>Privacy and terms</h2>
        <p>
          This preview has no accounts and stores nothing you type. Do not enter confidential or
          client information. A privacy notice and terms of use will be published before any live
          service is offered.
        </p>
      </section>
    </article>
  );
}
