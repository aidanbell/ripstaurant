import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigation,
} from "react-router";

export function Layout() {
  const navigation = useNavigation();
  const location = useLocation();
  const loadingAnotherPage =
    navigation.state === "loading" &&
    navigation.location?.pathname !== location.pathname;
  return (
    <>
      <header>
        <p>
          <Link to={{ pathname: "/", search: location.search }}>
            RIPstaurant
          </Link>
        </p>
        <nav aria-label="Main">
          <NavLink to={{ pathname: "/map", search: location.search }}>
            Map
          </NavLink>{" "}
          |{" "}
          <NavLink to={{ pathname: "/list", search: location.search }}>
            List
          </NavLink>{" "}
          | <NavLink to="/about">About</NavLink>
        </nav>
      </header>
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
    </>
  );
}
