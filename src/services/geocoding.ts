// City and place search. Nominatim (OpenStreetMap) is the primary provider; Photon (also OSM data, free, no key)
// is the fallback when Nominatim is blocked, throttled or down. Both are free services with no account.

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const PHOTON_URL = 'https://photon.komoot.io/api/';
const USER_AGENT = 'ActivityMapApp/1.0 (+https://github.com/gedasbar/activity_map)';
const REQUEST_TIMEOUT_MS = 8000;
const CITY_VIEWBOX_RADIUS = 0.25; // degrees, roughly 28 km around the city centre

export interface GeoCity {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
}

// Same shape Nominatim returns, so saved places and the UI keep working unchanged.
export interface GeoPlace {
  place_id: string | number;
  name: string;
  display_name: string;
  lat: string;
  lon: string;
}

export class GeocodingError extends Error {
  constructor(message = 'Search is unavailable right now. Check your connection and try again.') {
    super(message);
    this.name = 'GeocodingError';
  }
}

const abortError = () => Object.assign(new Error('Search cancelled'), { name: 'AbortError' });

export const isAbortError = (e: unknown) => (e as { name?: string } | null)?.name === 'AbortError';

// fetch + JSON with a timeout; the caller's signal still cancels it (as AbortError).
const fetchJson = async (url: string, signal?: AbortSignal): Promise<any> => {
  const controller = new AbortController();
  const onCallerAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', onCallerAbort);
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
    if (!response.ok) throw new GeocodingError(`Search service returned ${response.status}`);
    return await response.json();
  } catch (e) {
    if (signal?.aborted) throw abortError(); // cancelled by the caller: not an error
    throw e instanceof GeocodingError ? e : new GeocodingError();
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onCallerAbort);
  }
};

// Runs the primary provider, then the fallback. Cancellation is rethrown, never retried.
const withFallback = async <T>(primary: () => Promise<T>, fallback: () => Promise<T>, signal?: AbortSignal): Promise<T> => {
  try {
    return await primary();
  } catch (e) {
    if (signal?.aborted || isAbortError(e)) throw e;
  }
  return fallback();
};

const photonName = (p: any) => p.name || p.street || '';
const photonAddress = (p: any) =>
  [photonName(p), [p.street && p.street !== p.name ? p.street : '', p.housenumber].filter(Boolean).join(' '), p.city || p.locality, p.country]
    .filter(Boolean)
    .join(', ');

export const searchCities = (query: string, signal?: AbortSignal): Promise<GeoCity[]> => {
  const q = encodeURIComponent(query);

  const viaNominatim = async (): Promise<GeoCity[]> => {
    const data = await fetchJson(`${NOMINATIM_URL}?q=${q}&format=json&limit=7&featuretype=settlement&addressdetails=1&accept-language=lt,en`, signal);
    if (!Array.isArray(data)) throw new GeocodingError();
    return data.map((item: any) => {
      const cityName = item.name || item.address?.city || item.address?.town || item.address?.village || String(item.display_name).split(',')[0];
      const country = item.address?.country || '';
      return { id: `osm_${item.place_id}`, name: country ? `${cityName}, ${country}` : cityName, latitude: parseFloat(item.lat), longitude: parseFloat(item.lon) };
    });
  };

  const viaPhoton = async (): Promise<GeoCity[]> => {
    const data = await fetchJson(`${PHOTON_URL}?q=${q}&limit=7&layer=city&lang=en`, signal);
    return (data?.features ?? []).map((f: any) => {
      const p = f.properties ?? {};
      return {
        id: `osm_${p.osm_type}${p.osm_id}`,
        name: p.country ? `${p.name}, ${p.country}` : p.name,
        latitude: f.geometry.coordinates[1],
        longitude: f.geometry.coordinates[0],
      };
    });
  };

  return withFallback(viaNominatim, viaPhoton, signal);
};

export const searchPlaces = (query: string, city: { latitude: number; longitude: number } | null, signal?: AbortSignal): Promise<GeoPlace[]> => {
  const q = encodeURIComponent(query);
  const r = CITY_VIEWBOX_RADIUS;
  // Nominatim viewbox is left,top,right,bottom; Photon bbox is minLon,minLat,maxLon,maxLat.
  const viewbox = city ? `&viewbox=${city.longitude - r},${city.latitude + r},${city.longitude + r},${city.latitude - r}` : '';

  const nominatim = async (bounded: boolean): Promise<GeoPlace[]> => {
    const data = await fetchJson(`${NOMINATIM_URL}?q=${q}&format=json&limit=7&addressdetails=1&accept-language=lt,en${viewbox}${city ? `&bounded=${bounded ? 1 : 0}` : ''}`, signal);
    if (!Array.isArray(data)) throw new GeocodingError();
    return data;
  };

  // Prefer results inside the city's area; if there are none, fall back to a ranked-but-unbounded search.
  const viaNominatim = async () => {
    const inCity = await nominatim(true);
    return inCity.length > 0 || !city ? inCity : nominatim(false);
  };

  const viaPhoton = async (): Promise<GeoPlace[]> => {
    const bias = city ? `&lat=${city.latitude}&lon=${city.longitude}&bbox=${city.longitude - r},${city.latitude - r},${city.longitude + r},${city.latitude + r}` : '';
    const data = await fetchJson(`${PHOTON_URL}?q=${q}&limit=7&lang=en${bias}`, signal);
    return (data?.features ?? []).map((f: any) => {
      const p = f.properties ?? {};
      return {
        place_id: `photon_${p.osm_type}${p.osm_id}`,
        name: photonName(p),
        display_name: photonAddress(p),
        lat: String(f.geometry.coordinates[1]),
        lon: String(f.geometry.coordinates[0]),
      };
    });
  };

  return withFallback(viaNominatim, viaPhoton, signal);
};
