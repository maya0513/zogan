/** One Island identifier grammar shared by server descriptors, client markers, and Vite entries. */
export const ISLAND_ID_PATTERN = "^[A-Za-z][A-Za-z0-9_]{0,63}$";

const islandId = new RegExp(ISLAND_ID_PATTERN);

export const isIslandId = (value: string): boolean => islandId.test(value);
