import { useMemo, useState, type ReactNode } from 'react';
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

function SettingsSection({
  title,
  description,
  bordered,
  children,
}: {
  title: string;
  description: string;
  bordered?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={bordered ? 'mt-8 border-t border-border pt-8' : undefined}>
      <div className="grid gap-6 sm:grid-cols-[220px_1fr] sm:items-start">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        <div className="space-y-5 pt-1">{children}</div>
      </div>
    </section>
  );
}

function FieldLabel({ htmlFor, children }: { htmlFor?: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-2 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </label>
  );
}

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

  const patchOrigin = (patch: Partial<OwnFleetOrigin>) => {
    setOriginDraft({ ...origin, ...patch });
  };

  const dirty = zoneDraft !== null || originDraft !== null || districtDraft !== null;
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
    if (zones.length === 1) return;
    const remaining = districtsCoveredByZone(districts, key);
    if (remaining.length) {
      setDistrictDraft(remaining.reduce(
        (next, district) => unassignDistrict(next, district.key),
        districts,
      ));
    }
    setZoneDraft(zones.filter((zone) => zone.key !== key));
  };

  const addDistrict = (zoneKey: string, districtKey: string) => {
    setDistrictDraft(assignDistrictToZone(districts, districtKey, zoneKey));
  };

  const removeDistrict = (districtKey: string) => {
    setDistrictDraft(unassignDistrict(districts, districtKey));
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

  const saveButton = (
    <div className="flex justify-end">
      <Button type="button" onClick={submit} disabled={!dirty || nameless || save.isPending || configQuery.isPending}>
        {save.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
        Guardar
      </Button>
    </div>
  );

  return (
    <div className="space-y-6">
      {saveButton}
      {loadError ? <p className="text-sm text-destructive">{loadError}</p> : null}
      {nameless ? <p className="text-sm text-destructive">Ponle nombre a cada zona antes de guardar.</p> : null}

      <div className="rounded-xl border border-border bg-card p-4">
        <div>
          <FieldLabel htmlFor="own-fleet-address">Dirección</FieldLabel>
          <Input
            id="own-fleet-address"
            value={origin.address}
            onChange={(event) => patchOrigin({ address: event.target.value })}
            placeholder="C. las Almendras Mz.Z1 - Lt.5"
          />
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <FieldLabel htmlFor="own-fleet-lat">Latitud</FieldLabel>
            <Input
              id="own-fleet-lat"
              value={origin.lat}
              inputMode="decimal"
              onChange={(event) => patchOrigin({ lat: Number(event.target.value) })}
              className={NUMBER_INPUT}
            />
          </div>
          <div>
            <FieldLabel htmlFor="own-fleet-lng">Longitud</FieldLabel>
            <Input
              id="own-fleet-lng"
              value={origin.lng}
              inputMode="decimal"
              onChange={(event) => patchOrigin({ lng: Number(event.target.value) })}
              className={NUMBER_INPUT}
            />
          </div>
          <div>
            <FieldLabel htmlFor="own-fleet-pickup-from">Recojo desde</FieldLabel>
            <Input
              id="own-fleet-pickup-from"
              type="time"
              value={origin.pickupFrom}
              onChange={(event) => patchOrigin({ pickupFrom: event.target.value })}
            />
          </div>
          <div>
            <FieldLabel htmlFor="own-fleet-pickup-to">Recojo hasta</FieldLabel>
            <Input
              id="own-fleet-pickup-to"
              type="time"
              value={origin.pickupTo}
              onChange={(event) => patchOrigin({ pickupTo: event.target.value })}
            />
          </div>
        </div>
      </div>

      <div className="space-y-4 pt-2">
        {zones.map((zone) => {
          const members = districtsCoveredByZone(districts, zone.key);
          return (
            <div key={zone.key} className="rounded-xl border border-border bg-card p-4" aria-label={`Zona ${zone.name}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="grid min-w-0 flex-1 gap-4 sm:grid-cols-[1fr_8rem]">
                  <div>
                    <FieldLabel htmlFor={`zone-name-${zone.key}`}>Zona</FieldLabel>
                    <Input
                      id={`zone-name-${zone.key}`}
                      value={zone.name}
                      onChange={(event) => patchZone(zone.key, { name: event.target.value })}
                      aria-label={`Nombre de la zona ${zone.name}`}
                    />
                  </div>
                  <div>
                    <FieldLabel htmlFor={`zone-price-${zone.key}`}>Precio</FieldLabel>
                    <span className="flex items-center gap-1.5">
                      <span className="text-xs text-muted-foreground">S/</span>
                      <Input
                        id={`zone-price-${zone.key}`}
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
                        className={NUMBER_INPUT}
                      />
                    </span>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="mt-6 cursor-pointer"
                  disabled={zones.length === 1}
                  title={zones.length === 1 ? 'Deja al menos una zona.' : undefined}
                  aria-label={`Borrar la zona ${zone.name}`}
                  onClick={() => removeZone(zone.key)}
                >
                  <Trash2 />
                </Button>
              </div>

              <div className="mt-4 space-y-3">
                <DistrictCombobox
                  zoneName={zone.name}
                  options={freeDistricts}
                  onPick={(key) => addDistrict(zone.key, key)}
                />
                {configQuery.isPending && members.length === 0 && !districtDraft ? (
                  <p className="text-sm text-muted-foreground">Cargando distritos…</p>
                ) : members.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Ningún distrito en esta zona.</p>
                ) : (
                  <ul className="flex flex-wrap gap-2" aria-label={`Distritos de ${zone.name}`}>
                    {members.map((district) => (
                      <li key={district.key}>
                        <span className="inline-flex items-center gap-1 rounded-2xl border border-border bg-muted/40 py-0.5 pl-2 pr-0.5 text-xs font-medium text-foreground">
                          {district.name}
                          <button
                            type="button"
                            className="inline-flex size-5 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                            aria-label={`Quitar ${district.name} de ${zone.name}`}
                            onClick={() => removeDistrict(district.key)}
                          >
                            <X className="size-3" />
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          );
        })}

        <Button type="button" variant="outline" size="sm" className="cursor-pointer" onClick={addZone}>
          <Plus /> Agregar zona
        </Button>
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
      ? options.filter((district) => foldName(`${district.name} ${district.department}`).includes(needle))
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
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          window.setTimeout(() => setOpen(false), 120);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && matches[0]) {
            event.preventDefault();
            pick(matches[0].key);
          }
          if (event.key === 'Escape') setOpen(false);
        }}
        placeholder="Agregar distrito"
        aria-label={`Agregar distrito a ${zoneName}`}
        aria-autocomplete="list"
        aria-expanded={open}
        role="combobox"
        className="pl-9"
      />
      {open && options.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">Todos los distritos ya tienen zona.</p>
      ) : null}
      {open && query && matches.length === 0 && options.length > 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">Ningún distrito coincide.</p>
      ) : null}
      {open && matches.length > 0 ? (
        <ul
          role="listbox"
          aria-label={`Distritos para ${zoneName}`}
          className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-border bg-popover py-1 text-sm shadow-md"
        >
          {matches.map((district) => (
            <li key={district.key}>
              <button
                type="button"
                role="option"
                className="flex w-full cursor-pointer flex-col px-3 py-1.5 text-left hover:bg-muted"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pick(district.key)}
              >
                <span className="font-medium text-foreground">{district.name}</span>
                <span className="text-xs text-muted-foreground">{district.department}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
