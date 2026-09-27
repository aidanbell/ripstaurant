import { useCallback, useMemo } from "react";
import { useLoaderData, useSearchParams } from "react-router";
import { FilterForm } from "../../components/FilterForm";
import { PARAM, applyFilters, parseFilters } from "../../filters";
import type { mapLoader } from "../../loaders";
import { ClosureMap } from "./ClosureMap";
import { RestaurantRow } from "../../components/RestaurantRow";

export function MapPage() {
  const { list, boundaries } = useLoaderData<typeof mapLoader>();
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => parseFilters(params), [params]);
  const rows = useMemo(() => applyFilters(list, filters), [list, filters]);
  // A sorted copy: the map gets `rows` itself.
  const byName = useMemo(
    () => rows.toSorted((a, b) => a.name.localeCompare(b.name)),
    [rows],
  );
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

  return (
    <section>
      <h1>Map</h1>
      <FilterForm list={list} filters={filters} shown={rows.length} />
      <div className="flex flex-row gap-4 h-full w-full p-4">
        <div className="w-1/2 overflow-y-auto max-h-[70vh]">
          {byName.map((row) => (
            <RestaurantRow
              key={row.id}
              row={row}
              hood={list.hoods[row.hood] ?? ""}
            />
          ))}
        </div>
        <ClosureMap
          city={list.city}
          rows={rows}
          boundaries={boundaries}
          selected={outlines}
          onToggleHood={toggleHood}
        />
      </div>
    </section>
  );
}
