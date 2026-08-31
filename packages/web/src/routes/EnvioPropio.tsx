import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Search, Trash2, Wand2 } from 'lucide-react';
import api from '../lib/api';
import { useOperatorSnackbar } from '../components/OperatorSnackbar';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Switch } from '../components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TablePanel,
  TablePanelHeader,
  TableRow,
} from '../components/ui/table';
import type { OwnFleetDistrictSetting, OwnFleetOrigin, OwnFleetZone } from '../lib/own-fleet-shipping';
import { OWN_FLEET_ORIGIN, defaultZoneFor, foldName } from '../lib/own-fleet-shipping';

const QUERY_KEY = ['own-fleet-config'] as const;
const NUMBER_INPUT = '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';

type DistrictEdit = { zone?: string; enabled?: boolean };

function formatKm(value: number) {
  return `${Number(value || 0).toFixed(1).replace('.', ',')} km`;
}

export default function EnvioPropio() {
  const queryClient = useQueryClient();
  const { showSnackbar } = useOperatorSnackbar();
  const [search, setSearch] = useState('');
  const [zoneDraft, setZoneDraft] = useState<OwnFleetZone[] | null>(null);
  const [originDraft, setOriginDraft] = useState<OwnFleetOrigin | null>(null);
  const [districtEdits, setDistrictEdits] = useState<Record<string, DistrictEdit>>({});

  const configQuery = useQuery({
    queryKey: QUERY_KEY,
    queryFn: api.getOwnFleetConfig,
    staleTime: 15_000,
  });

  const save = useMutation({
    mutationFn: api.updateOwnFleetConfig,
    onSuccess: (data) => {
      queryClient.setQueryData(QUERY_KEY, data);
      setZoneDraft(null);
      setOriginDraft(null);
      setDistrictEdits({});
      showSnackbar({ message: 'Almacén, zonas y cobertura guardados.', tone: 'success' });
    },
    onError: (error: Error) => {
      showSnackbar({ message: error.message || 'No se pudo guardar.', tone: 'error', duration: 6000 });
    },
  });

  const zones = zoneDraft ?? configQuery.data?.zones ?? [];
  const origin = originDraft ?? configQuery.data?.origin ?? OWN_FLEET_ORIGIN;

  const patchOrigin = (patch: Partial<OwnFleetOrigin>) => {
    setOriginDraft({ ...origin, ...patch });
  };

  const districts = useMemo(() => (
    (configQuery.data?.districts || []).map((district) => ({
      ...district,
      ...districtEdits[district.key],
    }))
  ), [configQuery.data, districtEdits]);

  const districtsPerZone = useMemo(() => {
    const counts = new Map<string, number>();
    for (const district of districts) {
      counts.set(district.zone, (counts.get(district.zone) || 0) + 1);
    }
    return counts;
  }, [districts]);

  const visible = useMemo(() => {
    const needle = foldName(search);
    if (!needle) return districts;
    return districts.filter((district) => foldName(`${district.name} ${district.department}`).includes(needle));
  }, [districts, search]);

  // Un distrito queda desalineado cuando su zona ya no corresponde a su distancia actual.
  const bandFor = (district: OwnFleetDistrictSetting) => {
    const band = defaultZoneFor(district.distanceKm);
    return zones.some((zone) => zone.key === band.key) ? band.key : null;
  };
  const mismatched = districts.filter((district) => {
    const band = bandFor(district);
    return band !== null && band !== district.zone;
  });

  const regroupByDistance = () => {
    setDistrictEdits((current) => {
      const next = { ...current };
      for (const district of mismatched) {
        next[district.key] = { ...next[district.key], zone: bandFor(district)! };
      }
      return next;
    });
  };

  const dirty = zoneDraft !== null || originDraft !== null || Object.keys(districtEdits).length > 0;
  const loadError = configQuery.error instanceof Error
    ? configQuery.error.message
    : configQuery.error
      ? 'No se pudo cargar el envío propio.'
      : '';
  const nameless = zones.some((zone) => !zone.name.trim());

  const patchZone = (key: string, patch: Partial<OwnFleetZone>) => {
    setZoneDraft(zones.map((zone) => (zone.key === key ? { ...zone, ...patch } : zone)));
  };

  const addZone = () => {
    const taken = new Set(zones.map((zone) => zone.key));
    let index = zones.length + 1;
    while (taken.has(`zona-${index}`)) index += 1;
    setZoneDraft([...zones, { key: `zona-${index}`, name: `Zona ${index}`, amount: 0 }]);
  };

  const removeZone = (key: string) => {
    setZoneDraft(zones.filter((zone) => zone.key !== key));
  };

  const submit = () => {
    if (!dirty || save.isPending || nameless) return;
    save.mutate({
      origin,
      zones: zones.map((zone) => ({ key: zone.key, name: zone.name.trim(), amount: zone.amount })),
      districts: districts.map((district) => ({
        key: district.key,
        zone: district.zone,
        enabled: district.enabled,
      })),
    });
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
        <Button type="button" onClick={submit} disabled={!dirty || nameless || save.isPending || configQuery.isPending}>
          {save.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
          Guardar
        </Button>
      </div>

      {loadError ? <p className="text-sm text-destructive">{loadError}</p> : null}
      {nameless ? <p className="text-sm text-destructive">Ponle nombre a cada zona antes de guardar.</p> : null}

      <TablePanel aria-label="Almacén de salida">
        <TablePanelHeader>
          <p className="text-sm font-medium">Almacén</p>
          <p className="text-sm text-muted-foreground">
            De aquí sale el reparto. Mover el pin recalcula la distancia de todos los distritos.
          </p>
        </TablePanelHeader>
        <div className="grid gap-4 px-4 py-4 sm:grid-cols-2 sm:px-5">
          <label className="grid gap-1.5 sm:col-span-2">
            <span className="text-xs font-medium text-muted-foreground">Dirección</span>
            <Input
              value={origin.address}
              onChange={(event) => patchOrigin({ address: event.target.value })}
              placeholder="C. las Almendras Mz.Z1 - Lt.5"
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Latitud</span>
            <Input
              value={origin.lat}
              inputMode="decimal"
              onChange={(event) => patchOrigin({ lat: Number(event.target.value) })}
              className={NUMBER_INPUT}
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Longitud</span>
            <Input
              value={origin.lng}
              inputMode="decimal"
              onChange={(event) => patchOrigin({ lng: Number(event.target.value) })}
              className={NUMBER_INPUT}
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Recojo desde</span>
            <Input
              type="time"
              value={origin.pickupFrom}
              onChange={(event) => patchOrigin({ pickupFrom: event.target.value })}
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Recojo hasta</span>
            <Input
              type="time"
              value={origin.pickupTo}
              onChange={(event) => patchOrigin({ pickupTo: event.target.value })}
            />
          </label>
        </div>
      </TablePanel>

      <TablePanel aria-label="Zonas de envío propio">
        <TablePanelHeader>
          <p className="text-sm font-medium">Zonas</p>
          <p className="text-sm text-muted-foreground">
            Cada zona agrupa distritos por distancia y cobra un precio. El pedido paga solo el de su zona.
          </p>
        </TablePanelHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Zona</TableHead>
              <TableHead className="w-32">Precio</TableHead>
              <TableHead className="w-28 text-right">Distritos</TableHead>
              <TableHead className="w-16" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {zones.map((zone) => {
              const count = districtsPerZone.get(zone.key) || 0;
              return (
                <TableRow key={zone.key}>
                  <TableCell>
                    <Input
                      value={zone.name}
                      onChange={(event) => patchZone(zone.key, { name: event.target.value })}
                      aria-label={`Nombre de la zona ${zone.name}`}
                      className="h-8 max-w-56"
                    />
                  </TableCell>
                  <TableCell>
                    <label className="flex items-center gap-1.5">
                      <span className="text-xs text-muted-foreground">S/</span>
                      <Input
                        type="number"
                        min={0}
                        max={9999}
                        step={1}
                        value={Number.isFinite(zone.amount) ? zone.amount : 0}
                        onChange={(event) => {
                          const amount = Number(event.target.value);
                          if (!Number.isFinite(amount) || amount < 0) return;
                          patchZone(zone.key, { amount: Math.min(9999, amount) });
                        }}
                        aria-label={`Precio de la zona ${zone.name}`}
                        className={`h-8 w-24 ${NUMBER_INPUT}`}
                      />
                    </label>
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums text-muted-foreground">{count}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="cursor-pointer"
                      disabled={count > 0}
                      title={count > 0 ? 'Mueve sus distritos a otra zona para poder borrarla.' : undefined}
                      aria-label={`Borrar la zona ${zone.name}`}
                      onClick={() => removeZone(zone.key)}
                    >
                      <Trash2 />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
            <TableRow>
              <TableCell colSpan={4}>
                <Button type="button" variant="outline" size="sm" className="cursor-pointer" onClick={addZone}>
                  <Plus /> Agregar zona
                </Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </TablePanel>

      <TablePanel aria-label="Distritos de envío propio" aria-busy={configQuery.isPending}>
        <TablePanelHeader className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">Distritos</p>
            <p className="text-sm text-muted-foreground">
              {mismatched.length
                ? `${mismatched.length} ${mismatched.length === 1 ? 'distrito no coincide' : 'distritos no coinciden'} con su distancia al almacén.`
                : 'La distancia es desde el almacén. Sirve para agrupar; no se cobra.'}
            </p>
          </div>
          {mismatched.length ? (
            <Button type="button" variant="outline" size="sm" className="shrink-0 cursor-pointer" onClick={regroupByDistance}>
              <Wand2 /> Reagrupar por distancia
            </Button>
          ) : null}
        </TablePanelHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Distrito</TableHead>
              <TableHead className="w-28 text-right">Distancia</TableHead>
              <TableHead className="w-44">Zona</TableHead>
              <TableHead className="w-28 text-right">Llegamos</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {configQuery.isPending && districts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-muted-foreground">Cargando distritos…</TableCell>
              </TableRow>
            ) : visible.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-muted-foreground">Ningún distrito coincide.</TableCell>
              </TableRow>
            ) : visible.map((district) => (
              <DistrictRow
                key={district.key}
                district={district}
                zones={zones}
                onZone={(zone) => setDistrictEdits((current) => ({
                  ...current,
                  [district.key]: { ...current[district.key], zone },
                }))}
                onEnabled={(enabled) => setDistrictEdits((current) => ({
                  ...current,
                  [district.key]: { ...current[district.key], enabled },
                }))}
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
  zones,
  onZone,
  onEnabled,
}: {
  district: OwnFleetDistrictSetting;
  zones: OwnFleetZone[];
  onZone: (zone: string) => void;
  onEnabled: (enabled: boolean) => void;
}) {
  const zone = zones.find((candidate) => candidate.key === district.zone);
  return (
    <TableRow>
      <TableCell className="whitespace-normal">
        <span className="block text-sm font-medium text-foreground">{district.name}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{district.department}</span>
      </TableCell>
      <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
        {formatKm(district.distanceKm)}
      </TableCell>
      <TableCell>
        <Select value={zone ? district.zone : ''} onValueChange={onZone}>
          <SelectTrigger className="h-8 w-full" aria-label={`Zona de ${district.name}`}>
            <SelectValue placeholder="Elegir zona" />
          </SelectTrigger>
          <SelectContent>
            {zones.map((option) => (
              <SelectItem key={option.key} value={option.key}>
                {option.name} · S/ {option.amount}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
