import type { PageStatusProps } from "../sample.tsx";

export default function PageStatus({ page }: PageStatusProps): preact.JSX.Element {
  return <output aria-live="polite">Confirmed page: {page}</output>;
}
