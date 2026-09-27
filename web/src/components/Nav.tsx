import { cn } from "../utils/cn";
import { NavLink, useLocation } from "react-router";

export function Nav() {
  const location = useLocation();
  return (
    <nav
      aria-label="Main"
      className="sticky top-0 z-10 h-12 w-full flex p-2 justify-between text-primary border-b border-foreground [&_a]:no-underline bg-background"
    >
      <div className="flex items-center text-xl font-bold">RIP</div>
      <div className="flex items-center mx-auto w-full justify-center gap-1 sm:gap-4">
        <NavLink
          to={{ pathname: "/map", search: location.search }}
          className={({ isActive }) =>
            cn(
              "px-3 py-2 relative text-primary text-center sm:w-24",
              isActive && "border-b-2 border-accent",
            )
          }
        >
          Map
        </NavLink>
        <NavLink
          to={{ pathname: "/list", search: location.search }}
          className={({ isActive }) =>
            cn(
              "px-3 py-2 text-primary text-center sm:mx-2 sm:w-24",
              isActive && "border-b-2 border-accent",
            )
          }
        >
          List
        </NavLink>
        <NavLink
          to="/about"
          className={({ isActive }) =>
            cn(
              "px-3 py-2 text-primary text-center sm:mx-2 sm:w-24",
              isActive && "border-b-2 border-accent",
            )
          }
        >
          About
        </NavLink>
      </div>
      <div className="hidden w-12 sm:block" />
    </nav>
  );
}
