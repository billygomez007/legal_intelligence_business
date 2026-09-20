import type { LegalAuthority, SearchQuery } from '../data/types';
export function SearchFilters({
  query,
  authorities,
}: {
  query: SearchQuery;
  authorities: LegalAuthority[];
}) {
  const unique = (key: 'jurisdiction' | 'source' | 'practiceArea' | 'concept') => [
    ...new Set(authorities.map((a) => a[key])),
  ];
  const fields = [
    { name: 'jurisdiction', label: 'Jurisdiction', options: unique('jurisdiction') },
    { name: 'court', label: 'Court / source', options: unique('source') },
    { name: 'kind', label: 'Document type', options: ['case', 'legislation'] },
    {
      name: 'year',
      label: 'Year',
      options: [...new Set(authorities.map((a) => a.date.slice(0, 4)))].sort().reverse(),
    },
    { name: 'practiceArea', label: 'Practice area', options: unique('practiceArea') },
    { name: 'concept', label: 'Legal concept', options: unique('concept') },
  ] as const;
  return (
    <fieldset className="search-filters">
      <legend>Refine your research</legend>
      {fields.map(({ name, label, options }) => (
        <label className="field" key={name}>
          {label}
          <select name={name} defaultValue={query[name]}>
            <option value="">All {label.toLowerCase()}</option>
            {options.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      ))}
    </fieldset>
  );
}
