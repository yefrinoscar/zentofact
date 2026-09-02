import { useId } from 'react';
import { Input } from './ui/input';
import { creditNoteIssueDatePolicy } from '../lib/creditNoteIssueDate';

type CreditNoteIssueDateFieldProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  affectedDocumentDates?: readonly (string | null | undefined)[];
};

export function CreditNoteIssueDateField({
  value,
  onChange,
  disabled = false,
  affectedDocumentDates = [],
}: CreditNoteIssueDateFieldProps) {
  const inputId = useId();
  const helpId = useId();
  const policy = creditNoteIssueDatePolicy({ affectedDocumentDates });
  const previousMonthEndLabel = formatDate(policy.previousMonthEnd);
  const helpText = policy.canUsePreviousMonthEnd
    ? `Puedes usar ${previousMonthEndLabel}; después del día 2 la nota quedará en el mes actual.`
    : `Esta nota debe emitirse en el mes actual; no puede llevarse al ${previousMonthEndLabel}.`;

  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="text-sm font-medium text-foreground">
        Fecha de emisión
      </label>
      <Input
        id={inputId}
        type="date"
        value={value}
        min={policy.earliestDate}
        max={policy.today}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        required
        aria-describedby={helpId}
        className="max-w-52"
      />
      <p id={helpId} className="text-xs text-muted-foreground">
        {helpText}
      </p>
    </div>
  );
}

function formatDate(value: string): string {
  return `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}`;
}
