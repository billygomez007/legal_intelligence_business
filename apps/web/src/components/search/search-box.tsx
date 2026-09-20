import { Search } from 'lucide-react';

/**
 * The large research field: icon, input and gold submit button in one focus ring.
 * Presentational only: the parent supplies the <form> so filters or scope pills can share it.
 */
export function SearchBox({
  id,
  label,
  placeholder,
  name = 'q',
  defaultValue = '',
  buttonLabel = 'Search',
  maxLength = 1500,
}: {
  id: string;
  label: string;
  placeholder: string;
  name?: string;
  defaultValue?: string;
  buttonLabel?: string;
  maxLength?: number;
}) {
  return (
    <div className="searchbox">
      <Search className="searchbox-icon" size={20} aria-hidden="true" />
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        maxLength={maxLength}
        autoComplete="off"
      />
      <button type="submit" className="button lg">
        {buttonLabel}
      </button>
    </div>
  );
}
