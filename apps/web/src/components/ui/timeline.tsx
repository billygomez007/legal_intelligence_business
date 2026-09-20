/** A vertical activity timeline. Entries are listed newest first. */
export function Timeline({ items }: { items: string[] }) {
  return (
    <ol className="timeline">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ol>
  );
}
