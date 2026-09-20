/**
 * Decorative, original line illustration: a five-pointed star above a stepped gateway.
 * It is an abstract nod to Ghana's Black Star, not a depiction of a real monument or photograph.
 * Colour and opacity come from the `.landmark-motif` class in tokens; it is hidden from assistive tech.
 */
export function LandmarkMotif({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`landmark-motif ${className}`}
      viewBox="0 0 600 340"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <g transform="translate(300 62)">
        <path
          d="M0-40 9-12.4h29L14.6 4.7l8.9 27.7L0 15.3l-23.5 17.1 8.9-27.7L-38-12.4h29Z"
          fill="currentColor"
          fillOpacity="0.55"
        />
      </g>
      <g stroke="currentColor" strokeWidth="1.25">
        <path d="M120 118h360v34H120z" />
        <path d="M140 152h320v18H140z" />
        <path d="M168 170v170M232 170v170M368 170v170M432 170v170" />
        <path d="M232 340V226q68-74 136 0v114" />
        <path d="M100 118h400" strokeWidth="2" />
        <path d="M120 134h360" strokeOpacity="0.45" />
      </g>
    </svg>
  );
}
