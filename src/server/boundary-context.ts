import { createContext } from "preact";

/** Render phase used to reject browser-owned boundaries inside Fragment responses. */
export const renderKind = createContext<"fragment" | "page" | null>(null);

/** True while rendering the descendants owned by an Island. */
export const islandOwner = createContext(false);
