import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ToolbarSelectOption = {
  value: string;
  label: string;
};

export function ToolbarSelect({
  value,
  onValueChange,
  options,
  'aria-label': ariaLabel,
  className,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: ToolbarSelectOption[];
  'aria-label': string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [box, setBox] = useState({ top: 0, left: 0, width: 0 });
  const selected = options.find((option) => option.value === value) || options[0];

  function place() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setBox({
      top: Math.min(rect.bottom + 4, window.innerHeight - 16),
      left: rect.left,
      width: Math.max(rect.width, 176),
    });
  }

  function close() {
    setOpen(false);
  }

  function toggle() {
    if (open) {
      close();
      return;
    }
    place();
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') close();
    }
    function onReposition() {
      place();
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onReposition);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onReposition);
    };
  }, [open]);

  return (
    <div className={cn('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={toggle}
        className="flex h-9 w-full items-center justify-between gap-1.5 rounded-xl border border-transparent bg-input/50 px-3 py-2 text-left text-sm whitespace-nowrap outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20"
      >
        <span className="min-w-0 truncate">{selected?.label}</span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </button>
      {open ? createPortal(
        <>
          <div className="fixed inset-0 z-[79]" aria-hidden onMouseDown={close} />
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={ariaLabel}
            style={{ top: box.top, left: box.left, width: box.width }}
            className="fixed z-[80] max-h-72 overflow-x-hidden overflow-y-auto rounded-xl bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-foreground/10"
          >
            {options.map((option) => {
              const active = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={cn(
                    'relative flex min-h-8 w-full cursor-default items-center rounded-lg py-1.5 pr-8 pl-2.5 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground',
                    active && 'bg-accent/70',
                  )}
                  onClick={() => {
                    onValueChange(option.value);
                    close();
                  }}
                >
                  <span className="min-w-0 truncate">{option.label}</span>
                  {active ? <Check className="absolute right-2 size-4" /> : null}
                </button>
              );
            })}
          </div>
        </>,
        document.body,
      ) : null}
    </div>
  );
}
