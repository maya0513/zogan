import type { PageStatusProps } from "../island-props.ts";

export default function PageStatus({ page }: PageStatusProps): preact.JSX.Element {
  return <output aria-live="polite">Confirmed page: {page}</output>;
}
