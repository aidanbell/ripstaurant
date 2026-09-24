import type { CityList } from "@ripstaurant/contract";
import { Form, Link, useLocation } from "react-router";
import { PARAM } from "../filters";
import type { Filters } from "../filters";
import {
  BUSINESS_TYPE_OPTIONS,
  EVENT_TYPE_OPTIONS,
  REASON_OPTIONS,
} from "../labels";

type Props = { list: CityList; filters: Filters };

/**
 * The filter controls, for /map and /list. A GET form: submitting writes the inputs
 * into the URL's search params, which are the filters. Uncontrolled, and keyed by the
 * URL so the inputs reset to it after back/forward.
 */
export function FilterForm({ list, filters }: Props) {
  const location = useLocation();
  return (
    <Form method="get" key={location.search}>
      <p>
        <label>
          Name or address{" "}
          <input type="search" name={PARAM.q} defaultValue={filters.q} />
        </label>
      </p>

      <fieldset>
        <legend>What happened</legend>
        {EVENT_TYPE_OPTIONS.map((o) => (
          <label key={o.value}>
            <input
              type="checkbox"
              name={PARAM.types}
              value={o.value}
              defaultChecked={filters.types.includes(o.value)}
            />{" "}
            {o.label}{" "}
          </label>
        ))}
      </fieldset>

      <p>
        <label>
          Business{" "}
          <select
            name={PARAM.businessTypes}
            defaultValue={filters.businessTypes[0] ?? ""}
          >
            <option value="">Any</option>
            {BUSINESS_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>{" "}
        <label>
          Reason{" "}
          <select name={PARAM.reasons} defaultValue={filters.reasons[0] ?? ""}>
            <option value="">Any</option>
            {REASON_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>{" "}
        <label>
          Neighbourhood{" "}
          <select name={PARAM.hood} defaultValue={filters.hood ?? ""}>
            <option value="">Any</option>
            {list.hoods.map((hood) => (
              <option key={hood} value={hood}>
                {hood}
              </option>
            ))}
          </select>
        </label>
      </p>

      <p>
        <label>
          Closed from{" "}
          <input
            type="date"
            name={PARAM.from}
            defaultValue={filters.from ?? ""}
          />
        </label>{" "}
        <label>
          to{" "}
          <input type="date" name={PARAM.to} defaultValue={filters.to ?? ""} />
        </label>
      </p>

      <p>
        <button type="submit">Apply</button>{" "}
        <Link to={location.pathname}>Clear</Link>
      </p>
    </Form>
  );
}
