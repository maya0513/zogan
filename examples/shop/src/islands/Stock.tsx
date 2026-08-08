export default function Stock({ inventory = 0 }: { inventory?: number }) {
  return <span class={inventory > 0 ? "in-stock" : "sold-out"}>{inventory} available</span>;
}
