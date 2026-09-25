import { Link, Outlet, useLocation, useNavigation } from "react-router";
import { Nav } from "../components/Nav";

export function Layout() {
  const navigation = useNavigation();
  const location = useLocation();
  const loadingAnotherPage =
    navigation.state === "loading" &&
    navigation.location?.pathname !== location.pathname;
  return (
    <main className="min-h-screen flex flex-col bg-background text-foreground">
      <Nav />

      <main>
        {loadingAnotherPage && <p role="status">Loading…</p>}
        <Outlet />
      </main>
      <footer>
        <p>
          Contains information licensed under the{" "}
          <a href="https://open.toronto.ca/open-data-license/">
            Open Government Licence – Toronto
          </a>
          . <Link to="/about">Sources</Link>
        </p>
      </footer>
    </main>
  );
}
