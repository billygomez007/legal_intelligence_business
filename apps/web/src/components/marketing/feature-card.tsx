import type { Feature } from '../../content/marketing';

export function FeatureCard({ feature }: { feature: Feature }) {
  return (
    <li className="m-feature" id={feature.id}>
      <span className="icon-tile">
        <feature.icon size={22} strokeWidth={1.5} aria-hidden="true" />
      </span>
      <h3>{feature.title}</h3>
      <p className="m-feature-tagline">{feature.tagline}</p>
      <p className="muted">{feature.description}</p>
    </li>
  );
}
