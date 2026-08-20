import { z } from "zod";

export const PlaceCandidateSchema = z
  .object({
    id: z.string().min(3).max(220),
    name: z.string().trim().min(1).max(160),
    area: z.string().trim().min(1).max(160).nullable(),
    category: z.string().trim().min(1).max(80).nullable(),
  })
  .strict();

export const SelectedPlaceSchema = z
  .object({
    provider: z.string().trim().min(1).max(40),
    providerPlaceId: z.string().trim().min(1).max(180),
    displayName: z.string().trim().min(1).max(160),
    coarseArea: z.string().trim().min(1).max(160).nullable(),
    category: z.string().trim().min(1).max(80).nullable(),
    mapCellId: z.string().trim().min(1).max(32),
  })
  .strict();

export type PlaceCandidate = z.infer<typeof PlaceCandidateSchema>;
export type SelectedPlace = z.infer<typeof SelectedPlaceSchema>;
