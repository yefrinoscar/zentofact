// PROTOTYPE — tres formas de elegir canal en Empresas, vía ?variant= en el editor.
// Pregunta: ¿cómo debe verse Falabella / Ripley / Mercado Libre en el editor?
// Descartable: el ganador se reescribe en Companies.tsx.
import type { ReactNode } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import type { PrototypeVariant } from '../components/PrototypeSwitcher';

export type CompanyChannelTab = 'falabella' | 'ripley' | 'mercado_libre';

export const COMPANY_CHANNEL_TAB_VARIANTS: PrototypeVariant[] = [
  { key: 'A', name: 'Línea del pedido' },
  { key: 'B', name: 'Segmentos bandeja' },
  { key: 'C', name: 'Lista y panel' },
];

export type CompanyChannelOption = {
  value: CompanyChannelTab;
  label: string;
  src: string;
  helper: string;
  ready: boolean;
};

type CompanyChannelTabsPrototypeProps = {
  variant: string;
  channelTab: CompanyChannelTab;
  onChannelTabChange: (value: CompanyChannelTab) => void;
  channels: CompanyChannelOption[];
  panels: Record<CompanyChannelTab, ReactNode>;
};

function Mark({ src, label, className }: { src: string; label: string; className?: string }) {
  return <img src={src} alt="" title={label} className={cn('size-4 rounded-[3px] object-contain', className)} />;
}

function VariantA({ channelTab, onChannelTabChange, channels, panels }: Omit<CompanyChannelTabsPrototypeProps, 'variant'>) {
  return (
    <Tabs value={channelTab} onValueChange={(value) => onChannelTabChange(value as CompanyChannelTab)} className="mt-3 gap-0">
      <TabsList variant="line" aria-label="Canales" className="h-11 w-full justify-start gap-0 rounded-none border-b border-border bg-transparent p-0">
        {channels.map((channel) => (
          <TabsTrigger key={channel.value} value={channel.value} className="h-full flex-none rounded-none px-3">
            <Mark src={channel.src} label={channel.label} />
            {channel.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {channels.map((channel) => (
        <TabsContent key={channel.value} value={channel.value} className="space-y-4 pt-4">
          {panels[channel.value]}
        </TabsContent>
      ))}
    </Tabs>
  );
}

function VariantB({ channelTab, onChannelTabChange, channels, panels }: Omit<CompanyChannelTabsPrototypeProps, 'variant'>) {
  return (
    <div className="mt-3 space-y-4">
      <div role="tablist" aria-label="Canales" className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1">
        {channels.map((channel) => {
          const active = channelTab === channel.value;
          return (
            <button
              key={channel.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChannelTabChange(channel.value)}
              className={cn(
                'flex min-w-0 flex-col items-start gap-1 rounded-lg px-2.5 py-2 text-left',
                active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <Mark src={channel.src} label={channel.label} />
                <span className="truncate">{channel.label}</span>
              </span>
              <span className="text-[11px] leading-4 text-muted-foreground">{channel.helper}</span>
            </button>
          );
        })}
      </div>
      <div>{panels[channelTab]}</div>
    </div>
  );
}

function VariantC({ channelTab, onChannelTabChange, channels, panels }: Omit<CompanyChannelTabsPrototypeProps, 'variant'>) {
  return (
    <div className="mt-3 grid gap-4 md:grid-cols-[13.5rem_minmax(0,1fr)]">
      <div role="tablist" aria-label="Canales" className="flex flex-col gap-0.5">
        {channels.map((channel) => {
          const active = channelTab === channel.value;
          return (
            <button
              key={channel.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChannelTabChange(channel.value)}
              className={cn(
                'flex items-center gap-2 rounded-lg px-2.5 py-2 text-left',
                active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              )}
            >
              <Mark src={channel.src} label={channel.label} className="size-5" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{channel.label}</span>
                <span className="block text-[11px] text-muted-foreground">{channel.ready ? 'Configurado' : 'Pendiente'}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="min-w-0 space-y-4 md:border-l md:border-border md:pl-4">
        {panels[channelTab]}
      </div>
    </div>
  );
}

export function CompanyChannelTabsPrototype({
  variant,
  channelTab,
  onChannelTabChange,
  channels,
  panels,
}: CompanyChannelTabsPrototypeProps) {
  const props = { channelTab, onChannelTabChange, channels, panels };
  if (variant === 'B') return <VariantB {...props} />;
  if (variant === 'C') return <VariantC {...props} />;
  return <VariantA {...props} />;
}

export function companyChannelTabsPageClass(variant: string) {
  return variant === 'C' ? 'max-w-5xl' : 'max-w-3xl';
}
