import { cn } from '../../lib/cn';

// Switch accesible sin dependencia extra (estilo shadcn).
export function Switch({
  checked,
  onCheckedChange,
  disabled,
  className,
  activeClassName = 'bg-emerald-500',
  title,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  activeClassName?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      title={title}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'inline-flex h-6 w-11 shrink-0 items-center rounded-full px-0.5 transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        checked ? activeClassName : 'bg-slate-300',
        className,
      )}
    >
      <span
        className={cn(
          'h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200',
          checked ? 'translate-x-5' : 'translate-x-0',
        )}
      />
    </button>
  );
}
