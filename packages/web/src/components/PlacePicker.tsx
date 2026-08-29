import { useEffect, useRef, useState } from 'react';
import { Loader2, MapPin, Navigation, Search, X } from 'lucide-react';
import { cn } from '../lib/cn';
import {
  OUT_OF_PERU_MESSAGE,
  PERU_BBOX,
  countryFromComponents,
  isInPeru,
  peruPlaceFromComponents,
  placeAtCoordinates,
} from '../lib/own-fleet-shipping';
import {
  indexedPlaceToDestination,
  peruPlaceById,
  searchPeruPlaces,
  type IndexedPeruPlace,
} from '../lib/peru-places';
import { Button } from './ui/button';
import { Input } from './ui/input';

export type MapPlace = {
  label: string;
  district: string;
  province: string;
  department: string;
  lat: number;
  lng: number;
};

type Prediction = {
  placeId: string;
  main: string;
  secondary: string;
  localPlace?: IndexedPeruPlace;
};

const PERU_MAP_BOUNDS = {
  north: PERU_BBOX.maxLat,
  south: PERU_BBOX.minLat,
  west: PERU_BBOX.minLng,
  east: PERU_BBOX.maxLng,
};

function predictionFromLocal(place: IndexedPeruPlace): Prediction {
  return {
    placeId: place.id,
    main: place.district || place.department,
    secondary: place.district ? `${place.department}` : 'Departamento',
    localPlace: place,
  };
}

const LIMA = { lat: -12.0464, lng: -77.0428 };

declare global {
  interface Window {
    google?: any;
    gm_authFailure?: () => void;
  }
}

let mapsLoader: Promise<any> | null = null;

async function mapsApiKey() {
  const fromEnv = String(import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '').trim();
  if (fromEnv) return fromEnv;
  const response = await fetch('/order-management/geo/maps-key', { credentials: 'include' });
  const data = await response.json().catch(() => null);
  return String(data?.key || '').trim();
}

function loadGoogleMaps(key: string) {
  if (window.google?.maps?.places) return Promise.resolve(window.google);
  if (mapsLoader) return mapsLoader;
  mapsLoader = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&libraries=places&language=es&region=PE`;
    script.async = true;
    script.onload = () => {
      if (!window.google?.maps) {
        reject(new Error('Google Maps no respondió.'));
        return;
      }
      resolve(window.google);
    };
    script.onerror = () => {
      mapsLoader = null;
      reject(new Error('No se pudo cargar Google Maps.'));
    };
    document.head.appendChild(script);
  });
  return mapsLoader;
}

function destinationAtPin(
  lat: number,
  lng: number,
  extras?: { label?: string; district?: string; province?: string; department?: string },
): MapPlace {
  const atPin = placeAtCoordinates(lat, lng);
  const snapped = Boolean(atPin.district || atPin.department);
  const district = snapped ? (atPin.district || '') : (extras?.district || '');
  const province = snapped ? (atPin.province || '') : (extras?.province || '');
  const department = snapped ? (atPin.department || '') : (extras?.department || '');
  return {
    label: extras?.label
      || (district ? `${district}, ${department}` : department)
      || `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
    district,
    province,
    department,
    lat,
    lng,
  };
}

function placeFromGoogle(result: any, lat: number, lng: number): MapPlace | null {
  const components = result?.address_components || result?.addressComponents || [];
  const country = countryFromComponents(components);
  if (!isInPeru(lat, lng, country)) return null;
  const place = peruPlaceFromComponents(components);
  return destinationAtPin(lat, lng, {
    ...place,
    label: String(result?.formatted_address || result?.formattedAddress || result?.name || result?.displayName || ''),
  });
}

function mapSuggestions(suggestions: any[] | null | undefined): Prediction[] {
  return (suggestions || []).slice(0, 6).map((item: any) => {
    const prediction = item.placePrediction;
    return {
      placeId: String(prediction?.placeId || ''),
      main: String(prediction?.mainText?.toString?.() || prediction?.mainText?.text || prediction?.text?.toString?.() || ''),
      secondary: String(prediction?.secondaryText?.toString?.() || prediction?.secondaryText?.text || ''),
    };
  }).filter((row: Prediction) => row.placeId);
}

async function fetchPredictions(term: string): Promise<Prediction[]> {
  const google = window.google;
  if (google?.maps?.places?.AutocompleteSuggestion?.fetchAutocompleteSuggestions) {
    const request = {
      input: term,
      includedRegionCodes: ['pe'],
      language: 'es',
      region: 'pe',
    };
    try {
      const { suggestions } = await google.maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
        ...request,
        locationRestriction: PERU_MAP_BOUNDS,
      });
      return mapSuggestions(suggestions);
    } catch {
      const { suggestions } = await google.maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions(request);
      return mapSuggestions(suggestions);
    }
  }

  return new Promise((resolve) => {
    const service = new google.maps.places.AutocompleteService();
    const timer = window.setTimeout(() => resolve([]), 2500);
    service.getPlacePredictions(
      {
        input: term,
        componentRestrictions: { country: 'pe' },
        language: 'es',
        bounds: new google.maps.LatLngBounds(
          { lat: PERU_BBOX.minLat, lng: PERU_BBOX.minLng },
          { lat: PERU_BBOX.maxLat, lng: PERU_BBOX.maxLng },
        ),
        strictBounds: true,
      },
      (results: any[] | null, status: string) => {
        window.clearTimeout(timer);
        if (status !== 'OK' || !Array.isArray(results)) {
          resolve([]);
          return;
        }
        resolve(results.slice(0, 6).map((row) => ({
          placeId: String(row.place_id || ''),
          main: String(row.structured_formatting?.main_text || row.description || ''),
          secondary: String(row.structured_formatting?.secondary_text || ''),
        })).filter((row: Prediction) => row.placeId));
      },
    );
  });
}

async function fetchPlace(placeId: string): Promise<MapPlace | null> {
  const google = window.google;
  if (google?.maps?.places?.Place) {
    const place = new google.maps.places.Place({ id: placeId });
    await place.fetchFields({ fields: ['location', 'formattedAddress', 'addressComponents', 'displayName'] });
    const location = place.location;
    if (!location) return null;
    return placeFromGoogle(place, location.lat(), location.lng());
  }

  return new Promise((resolve) => {
    const host = document.createElement('div');
    const service = new google.maps.places.PlacesService(host);
    const timer = window.setTimeout(() => resolve(null), 2500);
    service.getDetails(
      { placeId, fields: ['formatted_address', 'geometry', 'address_components', 'name'] },
      (result: any, status: string) => {
        window.clearTimeout(timer);
        const location = result?.geometry?.location;
        if (status !== 'OK' || !location) {
          resolve(null);
          return;
        }
        resolve(placeFromGoogle(result, location.lat(), location.lng()));
      },
    );
  });
}

export function PlacePicker({
  value,
  onChange,
  placeholder = 'Busca una dirección',
}: {
  value: MapPlace | null;
  onChange: (place: MapPlace) => void;
  placeholder?: string;
}) {
  const mapNode = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const geocoderRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [locating, setLocating] = useState(false);
  const [query, setQuery] = useState('');
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [searching, setSearching] = useState(false);
  const [localMode, setLocalMode] = useState(false);
  const valueRef = useRef(value);
  valueRef.current = value;
  const point = value || LIMA;

  const restoreMarker = () => {
    const fallback = valueRef.current || LIMA;
    markerRef.current?.setPosition(fallback);
    mapRef.current?.panTo(fallback);
  };

  const rejectOutsidePeru = () => {
    setError(OUT_OF_PERU_MESSAGE);
    restoreMarker();
  };

  const applyLatLng = (lat: number, lng: number, readyMade?: MapPlace) => {
    if (readyMade) {
      if (!isInPeru(readyMade.lat, readyMade.lng)) {
        rejectOutsidePeru();
        return;
      }
      setError('');
      markerRef.current?.setPosition(readyMade);
      onChange(readyMade);
      return;
    }
    if (!isInPeru(lat, lng)) {
      rejectOutsidePeru();
      return;
    }
    const geocoder = geocoderRef.current;
    if (!geocoder) {
      setError('');
      markerRef.current?.setPosition({ lat, lng });
      onChange(destinationAtPin(lat, lng));
      return;
    }
    geocoder.geocode({ location: { lat, lng }, language: 'es', region: 'PE' }, (results: any[], status: string) => {
      if (status === 'OK' && results?.[0]) {
        const mapped = placeFromGoogle(results[0], lat, lng);
        if (!mapped) {
          rejectOutsidePeru();
          return;
        }
        setError('');
        markerRef.current?.setPosition({ lat, lng });
        onChange(mapped);
        return;
      }
      setError('');
      markerRef.current?.setPosition({ lat, lng });
      onChange(destinationAtPin(lat, lng));
    });
  };

  const showPlace = (place: MapPlace) => {
    if (!isInPeru(place.lat, place.lng)) {
      rejectOutsidePeru();
      return;
    }
    mapRef.current?.panTo(place);
    mapRef.current?.setZoom(17);
    markerRef.current?.setPosition(place);
    onChange(place);
    setQuery('');
    setPredictions([]);
    setActiveIndex(-1);
    setError('');
  };

  const pickPrediction = async (prediction: Prediction) => {
    const local = prediction.localPlace || peruPlaceById(prediction.placeId);
    if (local) {
      showPlace(destinationAtPin(local.lat, local.lng, indexedPlaceToDestination(local)));
      return;
    }
    const place = await fetchPlace(prediction.placeId);
    if (place) showPlace(place);
    else rejectOutsidePeru();
  };

  useEffect(() => {
    let cancelled = false;
    mapsApiKey()
      .then((key) => {
        if (!key) throw new Error('Falta GOOGLE_MAPS_API_KEY o VITE_GOOGLE_MAPS_API_KEY.');
        return loadGoogleMaps(key);
      })
      .then((google) => {
        if (cancelled || !mapNode.current) return;
        geocoderRef.current = new google.maps.Geocoder();
        const map = new google.maps.Map(mapNode.current, {
          center: point,
          zoom: 16,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          cameraControl: false,
          gestureHandling: 'greedy',
          clickableIcons: false,
          restriction: {
            latLngBounds: PERU_MAP_BOUNDS,
            strictBounds: true,
          },
        });
        const marker = new google.maps.Marker({
          map,
          position: point,
          draggable: true,
          animation: google.maps.Animation.DROP,
        });
        map.addListener('click', (event: any) => {
          applyLatLng(event.latLng.lat(), event.latLng.lng());
        });
        marker.addListener('dragend', () => {
          const position = marker.getPosition();
          if (!position) return;
          applyLatLng(position.lat(), position.lng());
        });
        mapRef.current = map;
        markerRef.current = marker;
        setReady(true);
        setError('');
      })
      .catch(() => {
        if (cancelled) return;
        setLocalMode(true);
        setReady(true);
        setError('');
      });
    return () => {
      cancelled = true;
      if (markerRef.current) {
        window.google?.maps?.event?.clearInstanceListeners(markerRef.current);
        markerRef.current.setMap(null);
      }
      if (mapRef.current) {
        window.google?.maps?.event?.clearInstanceListeners(mapRef.current);
      }
      markerRef.current = null;
      mapRef.current = null;
      geocoderRef.current = null;
      mapNode.current?.replaceChildren();
      document.querySelectorAll('.pac-container').forEach((node) => node.remove());
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current || !markerRef.current || !value) return;
    const position = markerRef.current.getPosition();
    if (position && Math.abs(position.lat() - value.lat) < 0.00001 && Math.abs(position.lng() - value.lng) < 0.00001) return;
    mapRef.current.panTo(value);
    markerRef.current.setPosition(value);
  }, [value]);

  useEffect(() => {
    const term = query.trim();
    if (!ready || term.length < 2) {
      setPredictions([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSearching(true);
      const request = localMode
        ? Promise.resolve(searchPeruPlaces(term).map(predictionFromLocal))
        : fetchPredictions(term);
      request
        .then((rows) => {
          if (cancelled) return;
          setPredictions(rows);
          setActiveIndex(-1);
        })
        .catch(() => {
          if (!cancelled) setPredictions([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 80);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, ready, localMode]);

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setError('Este dispositivo no permite compartir la ubicación.');
      return;
    }
    setLocating(true);
    setError('');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        if (!isInPeru(lat, lng)) {
          setLocating(false);
          rejectOutsidePeru();
          return;
        }
        mapRef.current?.panTo({ lat, lng });
        mapRef.current?.setZoom(17);
        if (localMode) {
          const atPin = destinationAtPin(lat, lng);
          if (atPin.district || atPin.department) showPlace(atPin);
          else applyLatLng(lat, lng);
          setLocating(false);
          return;
        }
        applyLatLng(lat, lng);
        setLocating(false);
      },
      () => {
        setLocating(false);
        setError('No se pudo obtener tu ubicación. Activa el GPS o marca el punto en el mapa.');
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  return (
    <div className="space-y-2">
      <div className="relative">
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={placeholder}
              aria-label="Buscar distrito o departamento"
              autoComplete="off"
              className="h-11 rounded-xl pr-9 pl-9"
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setQuery('');
                  setPredictions([]);
                }
                if (event.key === 'ArrowDown' && predictions.length) {
                  event.preventDefault();
                  setActiveIndex((current) => (current + 1) % predictions.length);
                }
                if (event.key === 'ArrowUp' && predictions.length) {
                  event.preventDefault();
                  setActiveIndex((current) => (current <= 0 ? predictions.length - 1 : current - 1));
                }
                if (event.key === 'Enter') {
                  event.preventDefault();
                  const selected = predictions[activeIndex] || predictions[0];
                  if (selected) pickPrediction(selected);
                }
              }}
            />
            {query && (
              <button
                type="button"
                className="absolute right-2.5 top-1/2 grid size-6 -translate-y-1/2 cursor-pointer place-items-center rounded-full text-muted-foreground hover:bg-muted"
                aria-label="Limpiar búsqueda"
                onClick={() => {
                  setQuery('');
                  setPredictions([]);
                }}
              >
                {searching ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-3.5" />}
              </button>
            )}
          </div>
          <Button type="button" variant="outline" className="h-11 shrink-0 cursor-pointer rounded-xl px-3" onClick={useMyLocation} disabled={!ready || locating}>
            {locating ? <Loader2 className="animate-spin" /> : <Navigation />}
            <span className="hidden sm:inline">Mi ubicación</span>
          </Button>
        </div>
        {predictions.length > 0 && (
          <ul className="absolute inset-x-0 top-[calc(100%+0.5rem)] z-40 max-h-64 overflow-y-auto rounded-xl border border-border bg-background py-1 shadow-lg">
            {predictions.map((prediction, index) => (
              <li key={prediction.placeId}>
                <button
                  type="button"
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => pickPrediction(prediction)}
                  className={cn(
                    'flex w-full cursor-pointer items-start gap-3 px-3 py-2.5 text-left',
                    index === activeIndex ? 'bg-muted' : 'hover:bg-muted/70',
                  )}
                >
                  <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                    <MapPin className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{prediction.main}</span>
                    {prediction.secondary && (
                      <span className="block truncate text-xs text-muted-foreground">{prediction.secondary}</span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {!localMode && <div ref={mapNode} className="h-56 w-full bg-muted sm:h-72" />}
        {localMode && (
          <div className="flex h-28 items-center gap-3 px-3 sm:h-32">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
              <MapPin className="size-5" />
            </span>
            <p className="text-sm leading-5 text-muted-foreground">
              {value
                ? value.label
                : 'Busca un distrito de Lima metropolitana. El envío se calcula al elegirlo.'}
            </p>
          </div>
        )}
        {!ready && !error && !localMode && (
          <div className="flex items-center justify-center gap-2 border-t border-border px-3 py-2.5 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Cargando Google Maps…
          </div>
        )}
        {error && (
          <p className="border-t border-border px-3 py-2.5 text-sm text-rose-700">{error}</p>
        )}
        {value && !localMode && (
          <p className="border-t border-border px-3 py-2.5 text-sm leading-5">
            {value.label}
          </p>
        )}
      </div>
    </div>
  );
}
