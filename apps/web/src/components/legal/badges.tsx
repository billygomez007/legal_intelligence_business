import { BadgeCheck, LockKeyhole, ShieldCheck } from 'lucide-react';
import type { LegalAuthority, RightsState, VerificationState } from '../../data/types';

const verificationLabels: Record<VerificationState, string> = {
  verified: 'Verified',
  'human-reviewed': 'Human reviewed',
  'machine-extracted': 'Machine extracted',
  unverified: 'Unverified',
};

const rightsLabels: Record<RightsState, string> = {
  available: 'Source available',
  restricted: 'Rights restricted',
  unavailable: 'Source unavailable',
};

/** Marks a page or panel as demonstration data. Override `label` for local, less prominent uses. */
export function DemoBadge({ label = 'Demonstration data' }: { label?: string }) {
  return <span className="demo-badge">{label}</span>;
}

export function VerificationBadge({ state }: { state: VerificationState }) {
  return (
    <span
      className={`badge verification ${state}`}
      title="Illustrative state only; no backend verification has occurred"
    >
      {state === 'verified' ? (
        <BadgeCheck size={12} aria-hidden="true" />
      ) : (
        <ShieldCheck size={12} aria-hidden="true" />
      )}
      {verificationLabels[state]} · demo
    </span>
  );
}

export function RightsBadge({ state }: { state: RightsState }) {
  return (
    <span className={`badge rights-${state}`}>
      {state === 'restricted' && <LockKeyhole size={12} aria-hidden="true" />}
      {rightsLabels[state]} · demo
    </span>
  );
}

/**
 * One trust badge for dense rows: the strongest verification state when there is one, otherwise the
 * source-rights state. Every badge carries its own "· demo" suffix.
 */
export function TrustBadge({ authority }: { authority: LegalAuthority }) {
  return authority.verification === 'verified' || authority.verification === 'human-reviewed' ? (
    <VerificationBadge state={authority.verification} />
  ) : (
    <RightsBadge state={authority.rights} />
  );
}

export function CourtBadge({ court }: { court: string }) {
  return <span className="court-badge">{court}</span>;
}
