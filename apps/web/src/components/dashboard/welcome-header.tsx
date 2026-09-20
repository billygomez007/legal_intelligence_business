import { LandmarkMotif } from '../brand/landmark-motif';
import { TodayLabel } from './today-label';

export function WelcomeHeader({ firstName }: { firstName: string }) {
  return (
    <header className="welcome">
      <LandmarkMotif className="welcome-motif" />
      <div className="welcome-main">
        <h1>Welcome back, {firstName}</h1>
        <p className="welcome-sub">Your legal research workspace</p>
      </div>
      <div className="welcome-aside">
        <TodayLabel />
        <p className="welcome-quote">“A more informed legal profession builds a stronger Ghana.”</p>
      </div>
    </header>
  );
}
