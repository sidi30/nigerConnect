import { z } from 'zod';

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
