import type { SelectHTMLAttributes } from 'react';

type SelectOption = {
  label: string;
  value: string;
};

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  options: readonly SelectOption[];
};

export function Select({ id, label, options, ...props }: SelectProps) {
  const selectId = id ?? `select-${label.toLowerCase().replaceAll(/\s+/g, '-')}`;

  return (
    <label className="ui-field" htmlFor={selectId}>
      <span className="ui-field__label">{label}</span>
      <select {...props} className="ui-input ui-select" id={selectId}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
