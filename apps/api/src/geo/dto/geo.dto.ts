import { z } from 'zod';

/**
 * Query parameters for the city search endpoint GET /geo/cities.
 *
 * `q`       — prefix/substring to search (required, 2–100 chars)
 * `country` — optional ISO-3166-1 alpha-2 filter (e.g. "FR")
 * `limit`   — max results to return, 1–20, default 20
 *
 * The 2-char minimum (mirrored in WorldCitiesService.search) keeps a single
 * letter from forcing a near-full scan of the ~135k-city dataset on this
 * @Public, unauthenticated endpoint.
 */
export const citiesQuerySchema = z.object({
  q: z.string().trim().min(2, 'q must be at least 2 characters').max(100),
  country: z
    .string()
    .length(2, 'country must be ISO-3166-1 alpha-2')
    .toUpperCase()
    .optional(),
  limit: z.coerce.number().int().min(1).max(20).default(20),
});
export type CitiesQueryDto = z.infer<typeof citiesQuerySchema>;

export const boundsSchema = z.object({
  north: z.coerce.number().min(-90).max(90),
  south: z.coerce.number().min(-90).max(90),
  east: z.coerce.number().min(-180).max(180),
  west: z.coerce.number().min(-180).max(180),
  zoom: z.coerce.number().int().min(1).max(20).default(5),
  type: z.enum(['all', 'people', 'associations']).default('people'),
});
export type BoundsDto = z.infer<typeof boundsSchema>;

export const nearbySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
  radius: z.coerce.number().positive().max(20_000).default(50),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type NearbyDto = z.infer<typeof nearbySchema>;

export const proximityPingSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});
export type ProximityPingDto = z.infer<typeof proximityPingSchema>;
