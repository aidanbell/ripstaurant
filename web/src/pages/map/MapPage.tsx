import type { LocationDetail } from "@ripstaurant/contract";
import { Suspense, useCallback, useMemo, useState } from "react";
import {
  Await,
  useLoaderData,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router";
import { FilterForm } from "../../components/FilterForm";
import {
  PARAM,
  VIEW,
  applyFilters,
  parseFilters,
  parseSort,
} from "../../filters";
import type { Sort } from "../../filters";
import type { mapLoader } from "../../loaders";
import { WIDE, useMediaQuery } from "../../utils/use-media-query";
import { ClosureList } from "./ClosureList";
import { ClosureMap } from "./ClosureMap";
import { ClosureSheet } from "./ClosureSheet";
import { LocationPanel } from "./LocationPanel";
import { MIDDLE_COVERS_PX } from "./sheet";

/** Set on the history entry a selection pushes, so closing it can go back instead. */
type SelectState = { fromList: true };

function isSelectState(state: unknown): state is SelectState {
  return typeof state === "object" && state !== null && "fromList" in state;
}

export function MapPage() {
  const { list, boundaries, selected, detail } =
    useLoaderData<typeof mapLoader>();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const filters = useMemo(() => parseFilters(params), [params]);
  const rows = useMemo(() => applyFilters(list, filters), [list, filters]);
  const sort = parseSort(params);
  const wide = useMediaQuery(WIDE);

  // Coming back to the list from a closure: its row gets focus again.
  const selectedId = selected?.id ?? null;
  const [shownId, setShownId] = useState(selectedId);
  const [returnTo, setReturnTo] = useState<string | null>(null);
  if (selectedId !== shownId) {
    if (shownId && !selectedId) setReturnTo(shownId);
    setShownId(selectedId);
  }

  /**
   * Opens a closure (from its dot or its row). The first one pushes a history entry, so
   * Back returns to the list; picking another while one's open replaces it.
   */
  const select = useCallback(
    (id: string) => {
      const next = new URLSearchParams(params);
      next.set(VIEW.at, id);
      const replacing = params.has(VIEW.at);
      setParams(next, {
        replace: replacing,
        state: replacing
          ? location.state
          : ({ fromList: true } satisfies SelectState),
        preventScrollReset: true,
      });
    },
    [params, setParams, location.state],
  );

  /** Back to the list: undoes the selection's history entry when it made one. */
  function close() {
    if (isSelectState(location.state)) {
      navigate(-1);
      return;
    }
    const next = new URLSearchParams(params);
    next.delete(VIEW.at);
    setParams(next, { replace: true, preventScrollReset: true });
  }

  function setSort(value: Sort) {
    const next = new URLSearchParams(params);
    if (value === "newest") next.delete(VIEW.sort);
    else next.set(VIEW.sort, value);
    setParams(next, { replace: true, preventScrollReset: true });
  }
  const outlines = useMemo(
    () =>
      boundaries?.features.filter((f) =>
        filters.hoods.includes(f.properties.name),
      ) ?? [],
    [boundaries, filters.hoods],
  );

  // Clicking a neighbourhood on the map adds it to the filter, or removes it.
  const toggleHood = useCallback(
    (name: string) =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          const selected = next.getAll(PARAM.hoods);
          next.delete(PARAM.hoods);
          const toggled = selected.includes(name)
            ? selected.filter((h) => h !== name)
            : [...selected, name];
          for (const hood of toggled) next.append(PARAM.hoods, hood);
          return next;
        },
        { preventScrollReset: true },
      ),
    [setParams],
  );

  function renderSide() {
    if (selected && detail)
      return (
        <Suspense fallback={<p role="status">Loading…</p>}>
          <Await
            resolve={detail}
            errorElement={
              <p>
                Couldn’t load this address.{" "}
                <button type="button" onClick={close} className="underline">
                  Back to the list
                </button>
              </p>
            }
          >
            {(loaded: LocationDetail) => (
              <LocationPanel
                detail={loaded}
                closureId={selected.id}
                onClose={close}
              />
            )}
          </Await>
        </Suspense>
      );
    return (
      <ClosureList
        rows={rows}
        hoods={list.hoods}
        sort={sort}
        onSortChange={setSort}
        onSelect={select}
        returnTo={returnTo}
      />
    );
  }

  return (
    // Phones: filters, then the map to the bottom of the screen, less the sheet's peek
    // (5rem, in ClosureSheet). Wide screens: filters and list on the left, map beside.
    // The map keeps its place in the tree, so crossing the breakpoint doesn't reload it.
    <section className="flex min-h-0 flex-1 flex-col max-md:pb-20 md:grid md:grid-cols-[minmax(20rem,26rem)_1fr] md:grid-rows-[auto_minmax(0,1fr)]">
      <h1 className="sr-only">Map of closures</h1>
      <div className="border-b border-foreground/20 p-3 md:border-r">
        <FilterForm list={list} filters={filters} shown={rows.length} />
      </div>
      <ClosureMap
        city={list.city}
        rows={rows}
        boundaries={boundaries}
        selected={outlines}
        onToggleHood={toggleHood}
        focus={selected}
        onSelect={select}
        // On phones the sheet rises to its middle stop over the map to show a selection.
        coveredBottom={wide ? 0 : MIDDLE_COVERS_PX}
        className="h-auto min-h-0 flex-1 md:col-start-2 md:row-span-2 md:row-start-1"
      />
      {/* Keyed by what it shows, so switching between list and details starts at the top. */}
      {wide ? (
        <div
          key={selectedId ?? "list"}
          className="min-h-0 overflow-y-auto border-r border-foreground/20 p-3"
        >
          {renderSide()}
        </div>
      ) : (
        <ClosureSheet
          title={selected?.addr ?? "Closures"}
          showLabel={selected ? "Show details" : "Show the list"}
          raiseFor={selectedId}
          contentKey={selectedId ?? "list"}
        >
          {renderSide()}
        </ClosureSheet>
      )}
    </section>
  );
}
