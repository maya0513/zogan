interface FakeIntersectionEntry {
  readonly isIntersecting: boolean;
  readonly target: Element;
}

/** Deterministic IntersectionObserver test double shared by both browser runtimes. */
export class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  disconnected = false;
  readonly targets: Element[] = [];

  constructor(
    private readonly callback: (entries: readonly FakeIntersectionEntry[]) => void,
    readonly options?: { readonly rootMargin?: string },
  ) {
    FakeIntersectionObserver.instances.push(this);
  }

  observe(target: Element): void {
    this.targets.push(target);
  }

  disconnect(): void {
    this.disconnected = true;
  }

  enter(isIntersecting = true): void {
    this.callback(this.targets.map((target) => ({ isIntersecting, target })));
  }
}
