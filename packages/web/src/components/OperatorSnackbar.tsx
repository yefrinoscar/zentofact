import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { X } from 'lucide-react';
import { cn } from '../lib/cn';
import { Button } from './ui/button';

export type SnackbarTone = 'success' | 'error';

export type SnackbarAction = {
  label: string;
  onClick: () => void;
};

export type SnackbarOptions = {
  message: string;
  tone?: SnackbarTone;
  /** Milliseconds. null = stays until dismissed. Success defaults to 5000. */
  duration?: number | null;
  action?: SnackbarAction;
};

type SnackbarState = SnackbarOptions & {
  id: number;
};

type SnackbarContextValue = {
  showSnackbar: (options: SnackbarOptions) => void;
  dismissSnackbar: () => void;
};

const SnackbarContext = createContext<SnackbarContextValue | null>(null);

export function OperatorSnackbarProvider({ children }: { children: ReactNode }) {
  const [snackbar, setSnackbar] = useState<SnackbarState | null>(null);
  const timerRef = useRef<number | null>(null);
  const idRef = useRef(0);

  const dismissSnackbar = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setSnackbar(null);
  }, []);

  const showSnackbar = useCallback((options: SnackbarOptions) => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const id = ++idRef.current;
    const tone = options.tone ?? 'success';
    const duration = options.duration ?? (tone === 'success' ? 5000 : null);
    setSnackbar({ ...options, tone, duration, id });
  }, []);

  useEffect(() => {
    if (!snackbar || snackbar.duration == null) return undefined;
    timerRef.current = window.setTimeout(() => {
      setSnackbar((current) => (current?.id === snackbar.id ? null : current));
      timerRef.current = null;
    }, snackbar.duration);
    return () => {
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [snackbar]);

  const value = useMemo(() => ({ showSnackbar, dismissSnackbar }), [dismissSnackbar, showSnackbar]);

  return (
    <SnackbarContext.Provider value={value}>
      {children}
      {snackbar && (
        <div
          className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:px-6"
          aria-live={snackbar.tone === 'error' ? 'assertive' : 'polite'}
        >
          <div
            role={snackbar.tone === 'error' ? 'alert' : 'status'}
            className={cn(
              'pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-xl px-4 py-3 shadow-lg ring-1 ring-black/5',
              snackbar.tone === 'error'
                ? 'bg-destructive text-destructive-foreground'
                : 'bg-foreground text-background',
            )}
          >
            <p className="min-w-0 flex-1 text-sm leading-5">{snackbar.message}</p>
            {snackbar.action && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  'h-8 shrink-0 cursor-pointer px-2 text-sm font-semibold',
                  snackbar.tone === 'error'
                    ? 'text-destructive-foreground hover:bg-white/10 hover:text-destructive-foreground'
                    : 'text-background hover:bg-background/10 hover:text-background',
                )}
                onClick={() => {
                  snackbar.action?.onClick();
                  dismissSnackbar();
                }}
              >
                {snackbar.action.label}
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={cn(
                'size-8 shrink-0 cursor-pointer',
                snackbar.tone === 'error'
                  ? 'text-destructive-foreground hover:bg-white/10 hover:text-destructive-foreground'
                  : 'text-background hover:bg-background/10 hover:text-background',
              )}
              aria-label="Cerrar"
              onClick={dismissSnackbar}
            >
              <X />
            </Button>
          </div>
        </div>
      )}
    </SnackbarContext.Provider>
  );
}

export function useOperatorSnackbar() {
  const context = useContext(SnackbarContext);
  if (!context) {
    throw new Error('useOperatorSnackbar must be used within OperatorSnackbarProvider');
  }
  return context;
}
