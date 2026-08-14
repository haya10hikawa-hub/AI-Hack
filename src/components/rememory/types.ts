export type EpistemicState =
  | "evidence"
  | "confirmed"
  | "inferred"
  | "unknown"
  | "disputed";

export type ProcessingState =
  | "ready"
  | "uploaded"
  | "processing"
  | "partial"
  | "failed";

export interface MemoryPlaceSummary {
  canonicalId: string | null;
  provider: string | null;
  providerPlaceId: string | null;
  label: string;
  area: string | null;
  category: string | null;
  source: "user_selected" | "legacy";
  truthState: "confirmed" | "inferred" | "evidence" | "unknown";
  mapCellId: string | null;
}

export interface MemoryThreadItem {
  id: string;
  title: string;
  capturedAt: string | null;
  placeLabel: string | null;
  placeState?: "confirmed" | "inferred" | "evidence" | "unknown";
  place?: MemoryPlaceSummary | null;
  photoCount: number;
  representativeImageUrl: string | null;
  representativeImageAlt?: string | null;
  state: EpistemicState;
  processingState?: ProcessingState;
  summary?: string | null;
  relationLabel?: string | null;
  relationState?: "confirmed" | "inferred" | null;
  hasOpenGap?: boolean;
  evidenceCount?: number;
}

export interface MemoryThreadPayload {
  memories: MemoryThreadItem[];
  pendingConfirmationCount?: number;
  partial?: boolean;
  partialMessage?: string | null;
}

export interface EvidenceItem {
  id: string;
  label: string;
  detail?: string | null;
  kind: "photo" | "metadata" | "user_correction" | "related_memory" | "other";
  sourceLabel?: string | null;
  imageUrl?: string | null;
  capturedAt?: string | null;
}

export interface ClaimItem {
  id: string;
  text: string;
  state: EpistemicState;
  origin: "deterministic" | "ai" | "user";
  evidenceIds: string[];
}

export interface MemoryDetailPayload {
  memory: MemoryThreadItem & {
    description?: string | null;
    updatedAt?: string | null;
  };
  reconstruction?: string | null;
  claims: ClaimItem[];
  evidence: EvidenceItem[];
  partial?: boolean;
  partialMessage?: string | null;
}

export interface MemoryGap {
  id: string;
  memoryId: string;
  memoryTitle: string;
  question: string;
  candidateLabel?: string | null;
  evidenceSummary?: string | null;
  state: "open" | "answered" | "skipped";
}

export interface ConfirmationPayload {
  gaps: MemoryGap[];
  partial?: boolean;
  partialMessage?: string | null;
}

export interface SearchInterpretation {
  time?: string | null;
  place?: string | null;
  people?: string[];
  activities?: string[];
  keywords?: string[];
}

export interface SearchCandidate {
  memory: MemoryThreadItem;
  matchReasons: string[];
}

export interface GroundedSource {
  claimId: string;
  label: string;
  kind: "evidence" | "user_correction";
}

export interface SearchPayload {
  interpretation: SearchInterpretation;
  answer?: string | null;
  answerState?: "grounded" | "unknown" | "clarification";
  candidates: SearchCandidate[];
  sources?: GroundedSource[];
  clarification?: string | null;
  partial?: boolean;
  partialMessage?: string | null;
  feedbackEnabled?: boolean;
  place?: MemoryPlaceSummary | null;
}

export interface UploadAcceptedItem {
  id: string;
  slotId?: string;
  name?: string;
  capturedAt?: string | null;
  state?: ProcessingState;
}

export interface UploadRejectedItem {
  slotId?: string;
  name: string;
  reason: string;
}

export interface UploadPayload {
  accepted: UploadAcceptedItem[];
  rejected: UploadRejectedItem[];
  sequenceIds?: string[];
  processingState: ProcessingState;
  message?: string | null;
  placeStatus?: "selected" | "not_selected" | "unavailable";
}

export interface PlaceCandidate {
  id: string;
  name: string;
  area: string | null;
  category: string | null;
}

export interface PlaceSearchPayload {
  candidates: PlaceCandidate[];
}

export interface PrivacyAiSettings {
  usePhotos: boolean;
  useCapturedAt: boolean;
  useLocation: boolean;
  useCalendar: boolean;
  usePersonalContext: boolean;
  searchLearning: boolean;
  memoryMap: boolean;
  locationPermissionState?: "granted" | "denied" | "prompt" | "unavailable";
  calendarConnectionState?: "connected" | "not_connected" | "unavailable";
}

export interface MemoryMapCell {
  cellId: string;
  state: "passed" | "experienced" | "memory";
  firstSeenAt: string;
  lastSeenAt: string;
  visitCount: number;
  dwellBucket: "pass_through" | "short" | "medium" | "long" | null;
  evidenceCount: number;
  memoryCount: number;
  coarsePlace: string | null;
  memories: Array<{ id: string; title: string; updatedAt: string }>;
}

export interface MemoryMapPayload {
  enabled: boolean;
  cells: MemoryMapCell[];
  coarseAreas: Array<{
    coarsePlace: string;
    memories: Array<{ id: string; title: string }>;
  }>;
  partial: boolean;
  partialMessage: string | null;
}
