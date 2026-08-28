import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Search } from 'lucide-react';
import api from '../lib/api';
import { useOperatorSnackbar } from '../components/OperatorSnackbar';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Switch } from '../components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TablePanel,
  TableRow,
} from '../components/ui/table';
import type { OwnFleetDistrictSetting } from '../lib/own-fleet-shipping';
import { foldName } from '../lib/own-fleet-shipping';

const QUERY_KEY = ['own-fleet-config'] as const;
const NUMBER_INPUT = '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';

type DistrictEdit = { amount?: number; enabled?: boolean };

export default function EnvioPropio() {
  const queryClient = useQueryClient();
  const { showSnackbar } = useOperatorSnackbar();
  const [search, setSearch] = useState('');
  const [edits, setEdits] = useState<Record<string, DistrictEdit>>({});

  const configQuery = useQuery({
    queryKey: QUERY_KEY,
    queryFn: api.getOwnFleetConfig,
    staleTime: 15_000,
  });

  const save = useMutation({
    mutationFn: (districts: Array<{ key: string; amount: number; enabled: boolean }>) =>
      api.updateOwnFleetConfig({ districts }),
    onSuccess: (data) => {
      queryClient.setQueryData(QUERY_KEY, data);
      setEdits({});
      showSnackbar({ message: 'Precios y cobertura guardados.', tone: 'success' });
    },
    onError: (error: Error) => {
      showSnackbar({
        message: error.message || 'No se pudo guardar.',
        tone: 'error',
        duration: 6000,
      });
    },
  });

  const districts = useMemo(() => (
    (configQuery.data?.districts || []).map((district) => ({
      ...district,
      ...edits[district.key],
    }))
  ), [configQuery.data, edits]);

  const visible = useMemo(() => {
    const needle = foldName(search);
    if (!needle) return districts;
    return districts.filter((district) => foldName(`${district.name} ${district.department}`).includes(needle));
  }, [districts, search]);

  const dirty = Object.keys(edits).length > 0;
  const loadError = configQuery.error instanceof Error
    ? configQuery.error.message
    : configQuery.error
      ? 'No se pudo cargar el envío propio.'
      : '';

  const patchDistrict = (key: string, patch: DistrictEdit) => {
    setEdits((current) => ({ ...current, [key]: { ...current[key], ...patch } }));
  };

  const submit = () => {
    if (!dirty || save.isPending) return;
    save.mutate(districts.map((district) => ({
      key: district.key,
      amount: district.amount,
      enabled: district.enabled,
    })));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar distrito"
            aria-label="Buscar distrito"
            className="pl-9"
          />
        </div>
        <Button type="button" onClick={submit} disabled={!dirty || save.isPending || configQuery.isPending}>
          {save.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
          Guardar
        </Button>
      </div>

      {loadError ? (
        <p className="text-sm text-destructive">{loadError}</p>
      ) : null}

      <TablePanel aria-label="Distritos de envío propio" aria-busy={configQuery.isPending}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Distrito</TableHead>
              <TableHead className="w-32">Precio</TableHead>
              <TableHead className="w-28 text-right">Llegamos</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {configQuery.isPending && districts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-muted-foreground">Cargando distritos…</TableCell>
              </TableRow>
            ) : visible.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-muted-foreground">Ningún distrito coincide.</TableCell>
              </TableRow>
            ) : visible.map((district) => (
              <DistrictRow
                key={district.key}
                district={district}
                onAmount={(amount) => patchDistrict(district.key, { amount })}
                onEnabled={(enabled) => patchDistrict(district.key, { enabled })}
              />
            ))}
          </TableBody>
        </Table>
      </TablePanel>
    </div>
  );
}

function DistrictRow({
  district,
  onAmount,
  onEnabled,
}: {
  district: OwnFleetDistrictSetting;
  onAmount: (amount: number) => void;
  onEnabled: (enabled: boolean) => void;
}) {
  return (
    <TableRow>
      <TableCell className="whitespace-normal">
        <span className="block text-sm font-medium text-foreground">{district.name}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{district.department}</span>
      </TableCell>
      <TableCell>
        <label className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">S/</span>
          <Input
            type="number"
            min={0}
            max={9999}
            step={1}
            value={Number.isFinite(district.amount) ? district.amount : 0}
            onChange={(event) => {
              const amount = Number(event.target.value);
              if (!Number.isFinite(amount) || amount < 0) return;
              onAmount(Math.min(9999, amount));
            }}
            aria-label={`Precio de ${district.name}`}
            className={`h-8 w-24 ${NUMBER_INPUT}`}
          />
        </label>
      </TableCell>
      <TableCell className="text-right">
        <Switch
          size="sm"
          checked={district.enabled}
          onCheckedChange={onEnabled}
          aria-label={`Llegamos a ${district.name}`}
        />
      </TableCell>
    </TableRow>
  );
}
