import {
  Link,
  Outlet,
  useLocation,
  useMatches,
  useNavigation,
} from "react-router";
import { Nav } from "../components/Nav";
import { cn } from "../utils/cn";

/** A route's `handle`. `fullscreen`: the page fills the screen below the nav, no scrolling. */
export type RouteHandle = { fullscreen?: boolean };

function isFullscreen(handle: unknown): boolean {
  return (
    typeof handle === "object" &&
    handle !== null &&
    "fullscreen" in handle &&
    handle.fullscreen === true
  );
}

export function Layout() {
  const navigation = useNavigation();
  const location = useLocation();
  const loadingAnotherPage =
    navigation.state === "loading" &&
    navigation.location?.pathname !== location.pathname;
  const fullscreen = useMatches().some((match) => isFullscreen(match.handle));
  return (
    <div
      className={cn(
        "flex flex-col bg-background text-foreground",
        fullscreen ? "h-dvh overflow-hidden" : "min-h-dvh",
      )}
    >
      <Nav />

      <main className="flex min-h-0 flex-1 flex-col">
        {loadingAnotherPage && <p role="status">Loading…</p>}
        <Outlet />
      </main>
      {/* Full-screen pages credit the licence on the map itself (ClosureMap). */}
      <footer className={cn(fullscreen && "hidden")}>
        <p>
          Contains information licensed under the{" "}
          <a href="https://open.toronto.ca/open-data-license/">
            Open Government Licence – Toronto
          </a>
          . <Link to="/about">Sources</Link>
        </p>
      </footer>
    </div>
  );
}
