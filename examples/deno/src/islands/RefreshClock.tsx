import { refreshFragment } from "zogan/client";

export default function RefreshClock(): preact.JSX.Element {
  return (
    <button type="button" onClick={() => void refreshFragment("/_f/clock")}>
      Refresh server time
    </button>
  );
}
