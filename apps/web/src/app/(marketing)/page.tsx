import { CTASection } from '../../components/marketing/cta-section';
import { FeatureCard } from '../../components/marketing/feature-card';
import { MarketingHero } from '../../components/marketing/marketing-hero';
import { MarketingSection } from '../../components/marketing/marketing-section';
import { TrustLayers } from '../../components/marketing/trust-layers';
import {
  about,
  lawFirms,
  productAreas,
  productNote,
  security,
  steps,
  trust,
} from '../../content/marketing';

export default function HomePage() {
  return (
    <>
      <MarketingHero />

      <MarketingSection
        id="product"
        eyebrow="Product"
        title="One workspace for Ghanaian legal research."
        intro="From the first search to the finished matter, each part of the workflow is built around the source."
      >
        <ul className="m-feature-grid">
          {productAreas.map((feature) => (
            <FeatureCard key={feature.id} feature={feature} />
          ))}
        </ul>
        <p className="m-note">{productNote}</p>
      </MarketingSection>

      <MarketingSection
        id="legal-intelligence"
        tone="elevated"
        eyebrow={trust.eyebrow}
        title={trust.title}
        intro={trust.intro}
      >
        <div className="m-trust-grid">
          <ul className="m-principles">
            {trust.principles.map((principle) => (
              <li key={principle.title}>
                <span className="icon-tile sm">
                  <principle.icon size={18} strokeWidth={1.6} aria-hidden="true" />
                </span>
                <div>
                  <h3>{principle.title}</h3>
                  <p className="muted">{principle.description}</p>
                </div>
              </li>
            ))}
          </ul>
          <TrustLayers />
        </div>
      </MarketingSection>

      <MarketingSection
        id="how-it-works"
        eyebrow="How it works"
        title="From question to matter in three steps."
      >
        <ol className="m-steps">
          {steps.map((step) => (
            <li key={step.title}>
              <h3>{step.title}</h3>
              <p className="muted">{step.description}</p>
            </li>
          ))}
        </ol>
      </MarketingSection>

      <MarketingSection
        id="law-firms"
        tone="elevated"
        eyebrow={lawFirms.eyebrow}
        title={lawFirms.title}
        intro={lawFirms.intro}
      >
        <ul className="m-feature-grid">
          {lawFirms.benefits.map((benefit) => (
            <li className="m-feature compact" key={benefit.title}>
              <span className="icon-tile sm">
                <benefit.icon size={18} strokeWidth={1.6} aria-hidden="true" />
              </span>
              <h3>{benefit.title}</h3>
              <p className="muted">{benefit.description}</p>
            </li>
          ))}
        </ul>
        <p className="m-note">{lawFirms.note}</p>
      </MarketingSection>

      <MarketingSection
        id="security"
        tone="dark"
        eyebrow={security.eyebrow}
        title={security.title}
        intro={security.intro}
      >
        <ul className="m-feature-grid">
          {security.items.map((item) => (
            <li className="m-feature compact" key={item.title}>
              <span className="icon-tile sm">
                <item.icon size={18} strokeWidth={1.6} aria-hidden="true" />
              </span>
              <h3>{item.title}</h3>
              <p className="muted">{item.description}</p>
            </li>
          ))}
        </ul>
        <p className="m-note">{security.note}</p>
      </MarketingSection>

      <MarketingSection id="about" eyebrow={about.eyebrow} title={about.title}>
        <div className="m-about">
          {about.body.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
          <p className="m-disclaimer">{about.disclaimer}</p>
        </div>
      </MarketingSection>

      <CTASection />
    </>
  );
}
