import { useEffect, useState, type ComponentProps } from 'react';
import { formatElapsed } from '@/lib/pagos-presentation';
import { cn } from '@/lib/utils';

const chevron = Array.from({ length: 9 }, (_, index) => {
  const row = Math.floor(index / 3);
  const column = index % 3;
  return (column + Math.abs(row - 1)) * 90;
});

function useElapsed() {
  const [deciseconds, setDeciseconds] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setDeciseconds((value) => value + 1), 100);
    return () => window.clearInterval(timer);
  }, []);
  return formatElapsed(deciseconds);
}

function LoaderGrid({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span aria-hidden className={cn('grid shrink-0 grid-cols-[repeat(3,4px)] gap-[1.5px] text-current', className)} {...props}>
      {chevron.map((delay, index) => (
        <span
          key={index}
          data-work-cell=""
          className="size-[4px] rounded-[1px] bg-current"
          style={{
            opacity: 0.15,
            animation: `pixel-on 650ms ease-in-out ${delay}ms infinite`,
          }}
        />
      ))}
    </span>
  );
}

export function WorkLoaderMark(props: ComponentProps<'span'>) {
  return <LoaderGrid {...props} />;
}

export function WorkLoader({
  label,
  detail,
}: {
  label: string;
  detail?: string;
}) {
  const elapsed = useElapsed();
  return (
    <div
      role="status"
      aria-live="polite"
      data-work-loader=""
      className="flex w-fit items-center gap-2.5 text-foreground"
    >
      <LoaderGrid />
      <span
        data-work-label=""
        className="bg-clip-text text-[13px] font-medium text-transparent"
        style={{
          backgroundImage: 'linear-gradient(90deg, var(--muted-foreground) 35%, var(--foreground) 50%, var(--muted-foreground) 65%)',
          backgroundSize: '200% 100%',
          animation: 'shimmer-text 1.4s linear infinite',
        }}
      >
        {label}
      </span>
      {detail ? (
        <span className="max-w-[16rem] truncate font-mono text-xs text-muted-foreground">{detail}</span>
      ) : null}
      <span className="font-mono text-xs tabular-nums text-muted-foreground">{elapsed}</span>
    </div>
  );
}
