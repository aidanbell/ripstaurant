import { useLoaderData } from "react-router";
import type { cityLoader } from "../../loaders";

export function MapPage() {
  const list = useLoaderData<typeof cityLoader>();
  const [west, south, east, north] = list.city.bbox;
  return (
    <section>
      <h1>Map</h1>
      <p>
        The map isn’t built yet. It will plot {list.closures.length} closures,
        centred on {list.city.center.join(", ")}, within {west}, {south} to{" "}
        {east}, {north}.
      </p>
    </section>
  );
}
