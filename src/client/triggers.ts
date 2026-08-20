export type ActivationTrigger = "load" | "idle" | "visible" | `media:${string}`;

type IdleGlobal = typeof globalThis & {
  requestIdleCallback?: (callback: () => void) => number;
  cancelIdleCallback?: (id: number) => void;
};

const noop = (): void => {};

/** Validate the complete trigger grammar before any browser work is scheduled. */
export const isActivationTrigger = (trigger: string): boolean =>
  trigger === "load" ||
  trigger === "idle" ||
  trigger === "visible" ||
  (trigger.startsWith("media:") && trigger.slice("media:".length).trim() !== "");

/**
 * Schedule one activation and return its cancellation function when work is pending.
 * Immediate triggers return null.
 */
export const scheduleTrigger = (
  element: Element,
  trigger: string,
  activate: () => void,
): (() => void) | null => {
  if (!isActivationTrigger(trigger)) {
    console.warn(`zogan: invalid activation trigger ${JSON.stringify(trigger)}; keeping fallback`);
    return null;
  }
  if (trigger === "load") {
    activate();
    return null;
  }
  let active = true;
  let cleanup = noop;
  const fire = (): void => {
    if (!active) return;
    active = false;
    cleanup();
    activate();
  };

  if (trigger === "idle") {
    const idle = globalThis as IdleGlobal;
    if (typeof idle.requestIdleCallback === "function") {
      const id = idle.requestIdleCallback(fire);
      const cancelIdle = idle.cancelIdleCallback;
      cleanup = () => {
        if (typeof cancelIdle === "function") cancelIdle(id);
      };
    } else {
      const id = setTimeout(fire, 1);
      cleanup = () => {
        clearTimeout(id);
      };
    }
    return () => {
      active = false;
      cleanup();
    };
  }

  if (trigger === "visible") {
    if (typeof IntersectionObserver !== "function") {
      console.warn(
        "zogan: IntersectionObserver is unavailable; keeping fragment or island fallback",
      );
      return null;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.target === element && entry.isIntersecting)) fire();
      },
      { rootMargin: "200px" },
    );
    cleanup = () => {
      observer.disconnect();
    };
    observer.observe(element);
    return () => {
      active = false;
      cleanup();
    };
  }

  if (trigger.startsWith("media:")) {
    if (typeof matchMedia !== "function") {
      console.warn("zogan: matchMedia is unavailable; keeping fragment or island fallback");
      return null;
    }
    const query = matchMedia(trigger.slice("media:".length).trim());
    if (query.matches) {
      activate();
      return null;
    }
    const onChange = (event: MediaQueryListEvent): void => {
      if (event.matches) fire();
    };
    cleanup = () => {
      query.removeEventListener("change", onChange);
    };
    query.addEventListener("change", onChange);
    return () => {
      active = false;
      cleanup();
    };
  }

  return null;
};
