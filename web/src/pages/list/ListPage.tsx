import { Link, useLoaderData, useSearchParams } from "react-router";
import { formatRange } from "../../format";
import type { cityLoader } from "../../loaders";
import { applyFilters, parseFilters } from "../../filters";
import { useMemo } from "react";
import { FilterForm } from "../../components/FilterForm";

const SHOWN = 50;

export function ListPage() {
  const list = useLoaderData<typeof cityLoader>();
  const [params] = useSearchParams();
  const filters = parseFilters(params);
  const rows = useMemo(() => applyFilters(list, filters), [list, params]);

  return (
    <section>
      <h1>Closures</h1>
      <p>
        {list.closures.length} closures in {list.city.name} since {list.since}.
        Newest {SHOWN}:
      </p>
      <FilterForm list={list} filters={filters} />
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Address</th>
            <th>Hood</th>
            <th>Closure</th>
            <th>Reason</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, SHOWN).map((row) => (
            <tr key={row.id}>
              <td>
                <Link to={`/location/${row.loc}`}>{row.name}</Link>
              </td>
              <td>{row.bt}</td>
              <td>{row.addr}</td>
              <td>{list.hoods[row.hood]}</td>
              <td>{row.type}</td>
              <td>{row.rs || "Unknown"}</td>
              <td>{formatRange(row.d)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
