/**
 * Query keys factory for rooms
 * Provides type-safe, hierarchical query keys
 */
export const roomKeys = {
  all: ["rooms"] as const,

  details: () => [...roomKeys.all, "detail"] as const,

  detail: (slug: string) => [...roomKeys.details(), slug] as const,

  guestCheck: (slug: string) => [...roomKeys.all, "guest-check", slug] as const,

  me: (slug: string) => [...roomKeys.all, "me", slug] as const,
} as const;

/**
 * Type assertion for query keys
 */
export type RoomKeys = typeof roomKeys;

/**
 * Query keys factory for call history
 */
export const historyKeys = {
  all: ["history"] as const,

  lists: () => [...historyKeys.all, "list"] as const,

  details: () => [...historyKeys.all, "detail"] as const,

  detail: (id: string) => [...historyKeys.details(), id] as const,
} as const;

/**
 * Type assertion for query keys
 */
export type HistoryKeys = typeof historyKeys;

/**
 * Query keys factory for room chat
 */
export const chatKeys = {
  all: ["chat"] as const,

  history: (roomId: string) => [...chatKeys.all, "history", roomId] as const,
} as const;

/**
 * Type assertion for chat keys
 */
export type ChatKeys = typeof chatKeys;

/**
 * Query keys factory for the developer console
 */
export const consoleKeys = {
  all: ["console"] as const,

  projects: () => [...consoleKeys.all, "projects"] as const,

  project: (id: string) => [...consoleKeys.all, "project", id] as const,

  keys: (id: string) => [...consoleKeys.project(id), "keys"] as const,

  rooms: (id: string) => [...consoleKeys.project(id), "rooms"] as const,

  recordings: (id: string) => [...consoleKeys.project(id), "recordings"] as const,
} as const;

/**
 * Type assertion for query keys
 */
export type ConsoleKeys = typeof consoleKeys;
