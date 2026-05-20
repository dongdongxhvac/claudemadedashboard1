// Current-weather lookup for the TV header.
// Uses Open-Meteo (https://open-meteo.com) — free, no API key, CORS-enabled.
// Default coordinates: Cambridge, MA (where the COVE buildings live).
import { useQuery } from '@tanstack/react-query';

export type WeatherSnapshot = {
  temperature: number;     // °F
  apparent:    number | null;  // "feels like", °F
  weathercode: number;     // WMO code (see openweather docs)
  windspeed:   number;     // mph
  is_day:      boolean;
  time:        string;     // ISO of observation
};

const DEFAULT_LAT = 42.3736;  // Cambridge, MA
const DEFAULT_LON = -71.1097;

export function useWeather(lat = DEFAULT_LAT, lon = DEFAULT_LON) {
  return useQuery({
    queryKey: ['weather', lat, lon],
    queryFn: async (): Promise<WeatherSnapshot | null> => {
      const url =
        `https://api.open-meteo.com/v1/forecast` +
        `?latitude=${lat}&longitude=${lon}` +
        `&current=temperature_2m,apparent_temperature,is_day,weather_code,wind_speed_10m` +
        `&temperature_unit=fahrenheit&wind_speed_unit=mph`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json() as {
        current?: {
          time: string;
          temperature_2m: number;
          apparent_temperature?: number;
          is_day: 0 | 1;
          weather_code: number;
          wind_speed_10m: number;
        };
      };
      if (!data.current) return null;
      return {
        temperature: data.current.temperature_2m,
        apparent:    data.current.apparent_temperature ?? null,
        weathercode: data.current.weather_code,
        windspeed:   data.current.wind_speed_10m,
        is_day:      data.current.is_day === 1,
        time:        data.current.time,
      };
    },
    staleTime: 10 * 60_000,        // 10 min — weather doesn't move that fast
    refetchInterval: 10 * 60_000,  // and the TV is always-on
    retry: 1,
  });
}

/** Short label + glyph from WMO weather code (https://open-meteo.com/en/docs). */
export function weatherDescription(code: number, isDay: boolean): { icon: string; label: string } {
  if (code === 0)                return { icon: isDay ? '☀' : '🌙', label: 'Clear' };
  if (code === 1)                return { icon: isDay ? '🌤' : '🌙', label: 'Mostly clear' };
  if (code === 2)                return { icon: '⛅', label: 'Partly cloudy' };
  if (code === 3)                return { icon: '☁',  label: 'Overcast' };
  if (code === 45 || code === 48) return { icon: '🌫', label: 'Fog' };
  if (code >= 51 && code <= 57)   return { icon: '🌦', label: 'Drizzle' };
  if (code >= 61 && code <= 67)   return { icon: '🌧', label: 'Rain' };
  if (code >= 71 && code <= 77)   return { icon: '🌨', label: 'Snow' };
  if (code >= 80 && code <= 82)   return { icon: '🌧', label: 'Showers' };
  if (code === 85 || code === 86) return { icon: '🌨', label: 'Snow showers' };
  if (code === 95)                return { icon: '⛈', label: 'Thunderstorm' };
  if (code === 96 || code === 99) return { icon: '⛈', label: 'Thunderstorm + hail' };
  return { icon: '·', label: '' };
}
