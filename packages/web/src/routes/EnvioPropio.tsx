import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Search, Trash2, X } from 'lucide-react';
import api from '../lib/api';
import { useOperatorSnackbar } from '../components/OperatorSnackbar';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import type { OwnFleetDistrictSetting, OwnFleetOrigin, OwnFleetZone } from '../lib/own-fleet-shipping';
import {
  OWN_FLEET_ORIGIN,
  assignDistrictToZone,
  districtsCoveredByZone,
  foldName,
  unassignDistrict,
  uncoveredDistricts,
} from '../lib/own-fleet-shipping';

const QUERY_KEY = ['own-fleet-config'] as const;
const NUMBER_INPUT = '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';
const FIELD_LABEL = 'mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground';
const BARE_INPUT = 'h-7 border-0 bg-transparent px-0 shadow-none focus-visible:border-transparent focus-visible:ring-0';

export default function EnvioPropio() {
  const queryClient = useQueryClient();
  const { showSnackbar } = useOperatorSnackbar();
  const [zoneDraft, setZoneDraft] = useState<OwnFleetZone[] | null>(null);
  const [originDraft, setOriginDraft] = useState<OwnFleetOrigin | null>(null);
  const [districtDraft, setDistrictDraft] = useState<OwnFleetDistrictSetting[] | null>(null);

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
      setDistrictDraft(null);
      showSnackbar({ message: 'Almacén, zonas y cobertura guardados.', tone: 'success' });
    },
    onError: (error: Error) => {
      showSnackbar({ message: error.message || 'No se pudo guardar.', tone: 'error', duration: 6000 });
    },
  });

  const zones = zoneDraft ?? configQuery.data?.zones ?? [];
  const origin = originDraft ?? configQuery.data?.origin ?? OWN_FLEET_ORIGIN;
  const districts = districtDraft ?? configQuery.data?.districts ?? [];
  const freeDistricts = useMemo(() => uncoveredDistricts(districts), [districts]);

  const patchOrigin = (patch: Partial<OwnFleetOrigin>) => setOriginDraft({ ...origin, ...patch });

  const dirty = zoneDraft !== null || originDraft !== null || districtDraft !== null;
  const loadError = configQuery.error instanceof Error
    ? configQuery.error.message
    : configQuery.error ? 'No se pudo cargar el envío propio.' : '';
  const nameless = zones.some((zone) => !zone.name.trim());

  const patchZone = (key: string, patch: Partial<OwnFleetZone>) =>
    setZoneDraft(zones.map((zone) => (zone.key === key ? { ...zone, ...patch } : zone)));

  const addZone = () => {
    const taken = new Set(zones.map((z) => z.key));
    let index = zones.length + 1;
    while (taken.has(`zona-${index}`)) index += 1;
    setZoneDraft([...zones, { key: `zona-${index}`, name: `Zona ${index}`, amount: 0 }]);
  };

  const removeZone = (key: string) => {
    if (zones.length === 1) return;
    const remaining = districtsCoveredByZone(districts, key);
    if (remaining.length) {
      setDistrictDraft(remaining.reduce((next, d) => unassignDistrict(next, d.key), districts));
    }
    setZoneDraft(zones.filter((z) => z.key !== key));
  };

  const addDistrict = (zoneKey: string, districtKey: string) =>
    setDistrictDraft(assignDistrictToZone(districts, districtKey, zoneKey));

  const removeDistrict = (districtKey: string) =>
    setDistrictDraft(unassignDistrict(districts, districtKey));

  const submit = () => {
    if (!dirty || save.isPending || nameless) return;
    save.mutate({
      origin,
      zones: zones.map((z) => ({ key: z.key, name: z.name.trim(), amount: z.amount })),
      districts: districts.map((d) => ({ key: d.key, zone: d.zone, enabled: d.enabled })),
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button type="button" onClick={submit} disabled={!dirty || nameless || save.isPending || configQuery.isPending}>
          {save.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
          Guardar
        </Button>
      </div>

      {loadError ? <p className="text-sm text-destructive">{loadError}</p> : null}
      {nameless ? <p className="text-sm text-destructive">Ponle nombre a cada zona antes de guardar.</p> : null}

      <div>
        <h3 className="mb-4 text-base font-semibold text-foreground">Almacén</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="own-fleet-address" className={FIELD_LABEL}>Dirección</label>
            <Input
              id="own-fleet-address"
              value={origin.address}
              onChange={(e) => patchOrigin({ address: e.target.value })}
              placeholder="C. las Almendras Mz.Z1 - Lt.5"
            />
          </div>
          <div>
            <label htmlFor="own-fleet-lat" className={FIELD_LABEL}>Latitud</label>
            <Input
              id="own-fleet-lat"
              value={origin.lat}
              inputMode="decimal"
              onChange={(e) => patchOrigin({ lat: Number(e.target.value) })}
              className={NUMBER_INPUT}
            />
          </div>
          <div>
            <label htmlFor="own-fleet-lng" className={FIELD_LABEL}>Longitud</label>
            <Input
              id="own-fleet-lng"
              value={origin.lng}
              inputMode="decimal"
              onChange={(e) => patchOrigin({ lng: Number(e.target.value) })}
              className={NUMBER_INPUT}
            />
          </div>
          <div>
            <label htmlFor="own-fleet-pickup-from" className={FIELD_LABEL}>Recojo desde</label>
            <Input
              id="own-fleet-pickup-from"
              type="time"
              value={origin.pickupFrom}
              onChange={(e) => patchOrigin({ pickupFrom: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="own-fleet-pickup-to" className={FIELD_LABEL}>Recojo hasta</label>
            <Input
              id="own-fleet-pickup-to"
              type="time"
              value={origin.pickupTo}
              onChange={(e) => patchOrigin({ pickupTo: e.target.value })}
            />
          </div>
        </div>
      </div>

      <div className="border-t border-border pt-6">
        <h3 className="mb-4 text-base font-semibold text-foreground">Zonas</h3>
        {zones.map((zone) => {
          const members = districtsCoveredByZone(districts, zone.key);
          return (
            <div key={zone.key} className="border-b border-border py-4" aria-label={`Zona ${zone.name}`}>
              <div className="mb-2 flex items-baseline gap-2">
                <Input
                  value={zone.name}
                  onChange={(e) => patchZone(zone.key, { name: e.target.value })}
                  aria-label={`Nombre de la zona ${zone.name}`}
                  className={`${BARE_INPUT} max-w-48 text-sm font-medium text-muted-foreground`}
                />
                <span className="flex items-baseline gap-1 text-sm text-muted-foreground">
                  <span>S/</span>
                  <Input
                    type="number"
                    min={0}
                    max={9999}
                    step={1}
                    value={Number.isFinite(zone.amount) ? zone.amount : 0}
                    onChange={(e) => {
                      const amount = Number(e.target.value);
                      if (!Number.isFinite(amount) || amount < 0) return;
                      patchZone(zone.key, { amount: Math.min(9999, amount) });
                    }}
                    aria-label={`Precio de la zona ${zone.name}`}
                    className={`${BARE_INPUT} ${NUMBER_INPUT} w-14 text-sm text-muted-foreground`}
                  />
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="ml-auto self-center cursor-pointer text-muted-foreground"
                  disabled={zones.length === 1}
                  title={zones.length === 1 ? 'Deja al menos una zona.' : undefined}
                  aria-label={`Borrar la zona ${zone.name}`}
                  onClick={() => removeZone(zone.key)}
                >
                  <Trash2 />
                </Button>
              </div>

              <DistrictCombobox
                zoneName={zone.name}
                options={freeDistricts}
                onPick={(key) => addDistrict(zone.key, key)}
              />

              {configQuery.isPending && members.length === 0 && !districtDraft ? (
                <p className="mt-2 text-sm text-muted-foreground">Cargando distritos…</p>
              ) : members.length > 0 ? (
                <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={`Distritos de ${zone.name}`}>
                  {members.map((district) => (
                    <li key={district.key}>
                      <span className="inline-flex items-center gap-1 rounded-full bg-muted/60 py-0.5 pl-2.5 pr-1 text-xs text-muted-foreground">
                        {district.name}
                        <button
                          type="button"
                          className="inline-flex size-4 cursor-pointer items-center justify-center rounded-full hover:bg-muted hover:text-foreground"
                          aria-label={`Quitar ${district.name} de ${zone.name}`}
                          onClick={() => removeDistrict(district.key)}
                        >
                          <X className="size-3" />
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          );
        })}

        <div className="pt-3">
          <Button type="button" variant="ghost" size="sm" className="cursor-pointer text-muted-foreground" onClick={addZone}>
            <Plus className="size-4" /> Agregar zona
          </Button>
        </div>
      </div>
    </div>
  );
}

function DistrictCombobox({
  zoneName,
  options,
  onPick,
}: {
  zoneName: string;
  options: OwnFleetDistrictSetting[];
  onPick: (key: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const matches = useMemo(() => {
    const needle = foldName(query);
    const pool = needle
      ? options.filter((d) => foldName(`${d.name} ${d.department}`).includes(needle))
      : options;
    return pool.slice(0, 8);
  }, [options, query]);

  const pick = (key: string) => {
    onPick(key);
    setQuery('');
    setOpen(false);
  };

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && matches[0]) { e.preventDefault(); pick(matches[0].key); }
          if (e.key === 'Escape') setOpen(false);
        }}
        placeholder="Agregar distrito"
        aria-label={`Agregar distrito a ${zoneName}`}
        aria-autocomplete="list"
        aria-expanded={open}
        role="combobox"
        className="pl-9"
      />
      {open ? (
        <ul
          role="listbox"
          aria-label={`Distritos para ${zoneName}`}
          className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-border bg-popover py-1 text-sm shadow-md"
        >
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-xs text-muted-foreground">
              {options.length === 0 ? 'Todos los distritos ya tienen zona.' : 'Ningún distrito coincide.'}
            </li>
          ) : matches.map((d) => (
            <li key={d.key}>
              <button
                type="button"
                role="option"
                className="flex w-full cursor-pointer flex-col px-3 py-1.5 text-left hover:bg-muted"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(d.key)}
              >
                <span className="font-medium text-foreground">{d.name}</span>
                <span className="text-xs text-muted-foreground">{d.department}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
