// Route loaders: they fetch through the data module before a route renders, so pages
// get their data with `useLoaderData<typeof loader>()`.

import type { LoaderFunctionArgs } from "react-router";
import { getLocation, loadBoundaries, loadCity } from "./data";
import { VIEW, findSelected } from "./filters";

export const CITY = "toronto";

/**
 * The map: the city's closures and neighbourhood outlines (in parallel), and the
 * selected closure's location (`?at=`). That one isn't awaited: the map renders
 * straight away and the details stream in beside it.
 */
export async function mapLoader({ request }: LoaderFunctionArgs) {
  const [list, boundaries] = await Promise.all([
    loadCity(CITY),
    loadBoundaries(CITY),
  ]);
  const selected = findSelected(
    list,
    new URL(request.url).searchParams.get(VIEW.at),
  );
  const detail = selected ? getLocation(CITY, selected.loc) : null;
  return { list, boundaries, selected, detail };
}
