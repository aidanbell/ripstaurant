import { createBrowserRouter, data, redirect } from "react-router";
import type { ShouldRevalidateFunctionArgs } from "react-router";
import { RouteError } from "./components/RouteError";
import { cityLoader, locationLoader, mapLoader } from "./loaders";
import { AboutPage } from "./pages/about/AboutPage";
import { Layout } from "./pages/Layout";
import { ListPage } from "./pages/list/ListPage";
import { LocationPage } from "./pages/location/LocationPage";
import { MapPage } from "./pages/map/MapPage";

// Data mode: each route's loader fetches before it renders. Filters will live in the
// URL's search params, shared by /map and /list.
export const router = createBrowserRouter([
  {
    path: "/",
    Component: Layout,
    ErrorBoundary: RouteError,
    HydrateFallback: () => <p>Loading…</p>,
    children: [
      {
        index: true,
        loader: ({ request }) => redirect(`/map${new URL(request.url).search}`),
      },
      {
        path: "map",
        loader: mapLoader,
        shouldRevalidate: revalidateOnPathChange,
        Component: MapPage,
      },
      {
        path: "list",
        loader: cityLoader,
        shouldRevalidate: revalidateOnPathChange,
        Component: ListPage,
      },
      {
        path: "location/:id",
        loader: locationLoader,
        Component: LocationPage,
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

/** Filters live in the query string. The city list does not depend on them. */
function revalidateOnPathChange({
  currentUrl,
  nextUrl,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  if (currentUrl.pathname === nextUrl.pathname) return false;
  return defaultShouldRevalidate;
}
