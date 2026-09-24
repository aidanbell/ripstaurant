import { useMemo } from "react";
import { useLoaderData, useSearchParams } from "react-router";
import { FilterForm } from "../../components/FilterForm";
import { applyFilters, parseFilters } from "../../filters";
import type { mapLoader } from "../../loaders";
import { ClosureMap } from "./ClosureMap";

export function MapPage() {
  const { list, boundaries } = useLoaderData<typeof mapLoader>();
  const [params] = useSearchParams();
  const filters = useMemo(() => parseFilters(params), [params]);
  const rows = useMemo(() => applyFilters(list, filters), [list, filters]);
  const outline = useMemo(
    () =>
      boundaries?.features.find((f) => f.properties.name === filters.hood) ??
      null,
    [boundaries, filters.hood],
  );

  return (
    <section>
      <h1>Map</h1>
      <FilterForm list={list} filters={filters} />
      <p>
        {rows.length} of {list.closures.length} closures
      </p>
      <ClosureMap city={list.city} rows={rows} outline={outline} />
    </section>
  );
}
