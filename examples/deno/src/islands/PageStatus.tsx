import { clientStore } from "zogan/client";

interface PageState {
  version: number;
  page: number;
}

const page = clientStore<PageState>("page", { version: 0, page: 1 });

export default function PageStatus(): preact.JSX.Element {
  return <output aria-live="polite">Confirmed page: {page.value.page}</output>;
}
