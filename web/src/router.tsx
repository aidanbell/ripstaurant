import { createBrowserRouter, data, redirect } from "react-router";
import type { ShouldRevalidateFunctionArgs } from "react-router";
import { RouteError } from "./components/RouteError";
import { VIEW } from "./filters";
import { mapLoader } from "./loaders";
import { AboutPage } from "./pages/about/AboutPage";
import { Layout } from "./pages/Layout";
import type { RouteHandle } from "./pages/Layout";
import { MapPage } from "./pages/map/MapPage";

// Data mode: each route's loader fetches before it renders. Filters and the selected
// closure live in the URL's search params.
export const router = createBrowserRouter([
  {
    path: "/",
    Component: Layout,
    ErrorBoundary: RouteError,
    HydrateFallback: () => <p>Loading…</p>,
    children: [
      {
        index: true,
        loader: mapLoader,
        shouldRevalidate: revalidateOnSelection,
        handle: { fullscreen: true } satisfies RouteHandle,
        Component: MapPage,
      },
      // Old addresses: the map and list were separate pages, and each location had one.
      { path: "map", loader: ({ request }) => toMap(request) },
      { path: "list", loader: ({ request }) => toMap(request) },
      {
        path: "location/:id",
        loader: ({ params }) =>
          redirect(`/?${new URLSearchParams({ [VIEW.at]: params.id ?? "" })}`),
      },
      { path: "about", Component: AboutPage },
      {
        path: "*",
        loader: () => {
          throw data("There’s no page at this address.", { status: 404 });
        },
      },
    ],
  },
]);

/** The map, keeping the filters. */
function toMap(request: Request) {
  return redirect(`/${new URL(request.url).search}`);
}

/**
 * Filters live in the query string and the city's files don't depend on them; only a
 * change of page or of selected closure (`?at=`) loads anything.
 */
function revalidateOnSelection({
  currentUrl,
  nextUrl,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  if (currentUrl.pathname !== nextUrl.pathname) return defaultShouldRevalidate;
  return (
    currentUrl.searchParams.get(VIEW.at) !== nextUrl.searchParams.get(VIEW.at)
  );
}
