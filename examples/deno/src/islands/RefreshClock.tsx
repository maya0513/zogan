"use client-only";

import { refreshFragment } from "zogan/client";
import type { RefreshClockProps } from "../island-props.ts";

export default function RefreshClock({ src }: RefreshClockProps): preact.JSX.Element {
  return (
    <button type="button" onClick={() => void refreshFragment(src)}>
      Refresh server time
    </button>
  );
}
