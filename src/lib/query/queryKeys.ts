export const queryKeys = {
  linkUsage: (userId: string) => ["linkUsage", userId] as const,
  itineraryUsage: (userId: string) => ["itineraryUsage", userId] as const,
  profile: (userId: string) => ["profile", userId] as const,
  subscription: (userId: string) => ["subscription", userId] as const,
  plans: () => ["plans"] as const,
  collections: () => ["collections"] as const,
  collection: (id: string) => ["collections", id] as const,
  itineraries: () => ["itineraries"] as const,
  itineraryDetail: (id: string) => ["itineraries", id] as const,
  itineraryNotes: (id: string) => ["itineraries", id, "notes"] as const,
  upcomingItineraries: (userId: string) => ["upcomingItineraries", userId] as const,
  mapClusters: (userId: string, source: string) => ["mapClusters", userId, source] as const,
  recentContent: (userId: string) => ["recentContent", userId] as const,
  recentlyViewed: (userId: string) => ["recentlyViewed", userId] as const,
  search: (query: string, filterType: string | null, offset: number) =>
    ["search", query, filterType, offset] as const,
  entityLocations: (entityType: string, entityId: string) =>
    ["entityLocations", entityType, entityId] as const,
  analysisMetrics: (page: number, pageSize: number) =>
    ["analysisMetrics", page, pageSize] as const,
  analysisMetricPoints: (limit: number) =>
    ["analysisMetricPoints", limit] as const,
  itineraryMetrics: (page: number, pageSize: number) =>
    ["itineraryMetrics", page, pageSize] as const,
  itineraryMetricPoints: (limit: number) =>
    ["itineraryMetricPoints", limit] as const,
  feedback: (page: number, pageSize: number, status: string) =>
    ["feedback", page, pageSize, status] as const,
  feedbackCounts: () => ["feedbackCounts"] as const,
  locationReferences: (
    locationId: string,
    exclude?: { itineraryId?: string; collectionId?: string },
  ) =>
    [
      "locationReferences",
      locationId,
      exclude?.itineraryId ?? null,
      exclude?.collectionId ?? null,
    ] as const,
} as const;
