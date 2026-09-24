import { Link, NavLink, Outlet, useNavigation } from "react-router";

export function Layout() {
  const navigation = useNavigation();
  return (
    <>
      <header>
        <p>
          <Link to="/">RIPstaurant</Link>
        </p>
        <nav aria-label="Main">
          <NavLink to="/map">Map</NavLink> | <NavLink to="/list">List</NavLink>{" "}
          | <NavLink to="/about">About</NavLink>
        </nav>
      </header>
      <main>
        {navigation.state === "loading" && <p role="status">Loading…</p>}
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
    </>
  );
}
