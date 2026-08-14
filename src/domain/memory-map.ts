import { getResolution, isValidCell, latLngToCell } from "h3-js";

export const MEMORY_MAP_H3_RESOLUTION = 10;
export const MEMORY_MAP_MAX_CELLS = 500;

export const MEMORY_MAP_STATES = ["passed", "experienced", "memory"] as const;

export type MemoryMapCellState = (typeof MEMORY_MAP_STATES)[number];

const stateRank: Record<MemoryMapCellState, number> = {
  passed: 0,
  experienced: 1,
  memory: 2,
};

export function isAllowedMemoryMapCell(cellId: string): boolean {
  return (
    /^[0-9a-f]{15}$/u.test(cellId) &&
    isValidCell(cellId) &&
    getResolution(cellId) === MEMORY_MAP_H3_RESOLUTION
  );
}

export function coordinatesToMemoryMapCell(
  latitude: number,
  longitude: number,
): string {
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new Error("位置情報を地域セルへ変換できませんでした。");
  }
  return latLngToCell(latitude, longitude, MEMORY_MAP_H3_RESOLUTION);
}

export function progressMemoryMapState(
  current: MemoryMapCellState,
  requested: MemoryMapCellState,
): MemoryMapCellState {
  return stateRank[requested] > stateRank[current] ? requested : current;
}

export type OpportunityRadius = "auto" | 100 | 200 | 300 | 400;

export interface MemoryOpportunityCandidate {
  id: string;
  cellId: string;
  coarseLabel: string;
  radiusMeters: Exclude<OpportunityRadius, "auto">;
  source: "provider" | "manual";
}
