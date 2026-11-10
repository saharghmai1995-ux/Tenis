// ─── NeoTennis Markov Quant — Outdoor Court Weather Service ────────────────
// Wind speed & humidity directly affect serve velocity on outdoor courts.
// Primary: Open-Meteo (zero-key) · Fallback: wttr.in (zero-key)

import type { WeatherInfo } from "./types";

const WEATHER_TTL_MS = 30 * 60 * 1000;

interface CityCoords {
  lat: number;
  lon: number;
}

const geoCache = new Map<string, CityCoords>();
const weatherCache = new Map<string, { at: number; info: WeatherInfo }>();

async function geocodeCity(city: string): Promise<CityCoords | null> {
  const key = city.toLowerCase().trim();
  const hit = geoCache.get(key);
  if (hit) return hit;
  try {
    const res = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`,
      { signal: AbortSignal.timeout(8000), cache: "no-store" }
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      results?: { latitude: number; longitude: number }[];
    };
    const r = json.results?.[0];
    if (!r) return null;
    const coords = { lat: r.latitude, lon: r.longitude };
    geoCache.set(key, coords);
    return coords;
  } catch {
    return null;
  }
}

async function openMeteoCurrent(
  coords: CityCoords
): Promise<{ tempC: number; humidity: number; windKph: number } | null> {
  try {
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&current=temperature_2m,relative_humidity_2m,wind_speed_10m`,
      { signal: AbortSignal.timeout(8000), cache: "no-store" }
    );
    const json = (await res.json()) as {
      current?: {
        temperature_2m?: number;
        relative_humidity_2m?: number;
        wind_speed_10m?: number;
      };
      error?: boolean;
      reason?: string;
    };
    if (json.error || !json.current) return null;
    return {
      tempC: json.current.temperature_2m ?? 0,
      humidity: json.current.relative_humidity_2m ?? 0,
      windKph: (json.current.wind_speed_10m ?? 0) * 3.6, // km/h
    };
  } catch {
    return null;
  }
}

async function wttrCurrent(
  city: string
): Promise<{ tempC: number; humidity: number; windKph: number } | null> {
  try {
    const res = await fetch(
      `https://wttr.in/${encodeURIComponent(city)}?format=j1`,
      {
        signal: AbortSignal.timeout(9000),
        cache: "no-store",
        headers: { "user-agent": "Mozilla/5.0 (NeoTennisQuant/1.0)" },
      }
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      current_condition?: {
        temp_C?: string;
        humidity?: string;
        windspeedKmph?: string;
      }[];
    };
    const c = json.current_condition?.[0];
    if (!c) return null;
    return {
      tempC: parseFloat(c.temp_C ?? "0"),
      humidity: parseFloat(c.humidity ?? "0"),
      windKph: parseFloat(c.windspeedKmph ?? "0"),
    };
  } catch {
    return null;
  }
}

export async function fetchCityWeather(city?: string): Promise<WeatherInfo | null> {
  if (!city) return null;
  const key = city.toLowerCase().trim();
  const cached = weatherCache.get(key);
  if (cached && Date.now() - cached.at < WEATHER_TTL_MS) return cached.info;

  let info: WeatherInfo;
  const coords = await geocodeCity(city);
  if (coords) {
    const om = await openMeteoCurrent(coords);
    if (om) {
      info = { city, source: "open-meteo", ok: true, ...om };
    } else {
      const w = await wttrCurrent(city);
      info = w
        ? { city, source: "wttr-in", ok: true, ...w }
        : {
            city,
            source: "wttr-in",
            ok: false,
            note: "weather feed unavailable (both keyless providers)",
          };
    }
  } else {
    const w = await wttrCurrent(city);
    info = w
      ? { city, source: "wttr-in", ok: true, ...w }
      : { city, source: "wttr-in", ok: false, note: "geocoding failed" };
  }
  weatherCache.set(key, { at: Date.now(), info });
  return info;
}
