import type { CityList } from "@ripstaurant/contract";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import {
  Form,
  Link,
  useLocation,
  useNavigationType,
  useSubmit,
} from "react-router";
import { PARAM } from "../filters";
import type { Filters } from "../filters";
import {
  BUSINESS_TYPE_OPTIONS,
  EVENT_TYPE_OPTIONS,
  REASON_OPTIONS,
} from "../labels";
import { Checkbox } from "./ui/checkbox";
import { MultiCombobox } from "./ui/combobox";
import { Select } from "./ui/select";

type Props = { list: CityList; filters: Filters };

const SEARCH_DEBOUNCE_MS = 250;

/**
 * The filter controls, for /map and /list. The URL's search params are the filters.
 * Selects, checkboxes, the neighbourhood picker and dates write the URL immediately. The search box waits
 * briefly so typing doesn't navigate on every key. The first change in a visit
 * pushes a history entry; further changes replace it, so Back leaves the filtered
 * view. The form remounts when a non-search param changes, which resets those
 * uncontrolled inputs after Back/Forward.
 *
 * Native inputs (dates) reach onFormChange through the form's change event. Base UI
 * controls update their hidden inputs themselves and fire no change event, so they
 * call submitSoon, which reads the form once the new values are in the DOM.
 */
export function FilterForm({ list, filters }: Props) {
  const location = useLocation();
  const navigationType = useNavigationType();
  const submit = useSubmit();
  const formRef = useRef<HTMLFormElement>(null);
  const timeout = useRef<number | undefined>(undefined);
  const wroteThisEntry = useRef(false);
  const [query, setQuery] = useState(filters.q);
  const [historyKey, setHistoryKey] = useState(location.key);
  const hoodOptions = useMemo(
    () => list.hoods.map((hood) => ({ value: hood, label: hood })),
    [list.hoods],
  );

  if (navigationType === "POP" && historyKey !== location.key) {
    setHistoryKey(location.key);
    setQuery(filters.q);
  }

  const controlsKey = controlsSearch(location.search);

  useEffect(() => {
    if (navigationType !== "POP") return;
    window.clearTimeout(timeout.current);
    wroteThisEntry.current = false;
  }, [location.key, navigationType]);

  useEffect(() => {
    return () => window.clearTimeout(timeout.current);
  }, []);

  function submitParams(params: URLSearchParams) {
    window.clearTimeout(timeout.current);
    if (paramsKey(params) === paramsKey(new URLSearchParams(location.search)))
      return;
    const replace = wroteThisEntry.current;
    wroteThisEntry.current = true;
    submit(params, {
      replace,
      preventScrollReset: true,
      defaultShouldRevalidate: false,
    });
  }

  function submitForm(form: HTMLFormElement) {
    submitParams(formToParams(form));
  }

  /** After a Base UI change: its hidden inputs update on the next render. */
  function submitSoon() {
    requestAnimationFrame(() => {
      const form = formRef.current;
      if (form) submitForm(form);
    });
  }

  function onQueryChange(value: string) {
    setQuery(value);
    window.clearTimeout(timeout.current);
    timeout.current = window.setTimeout(() => {
      const form = formRef.current;
      if (form) submitForm(form);
    }, SEARCH_DEBOUNCE_MS);
  }

  function onFormChange(event: ChangeEvent<HTMLFormElement>) {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.type === "search") return;
    submitForm(event.currentTarget);
  }

  return (
    <Form
      method="get"
      ref={formRef}
      key={controlsKey}
      onChange={onFormChange}
      className="flex flex-wrap gap-2"
    >
      <p>
        <label>
          Name or address{" "}
          <input
            type="search"
            name={PARAM.q}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
          />
        </label>
      </p>

      <fieldset>
        <legend>What happened</legend>
        {EVENT_TYPE_OPTIONS.map((o) => (
          <Checkbox
            key={o.value}
            label={o.label}
            name={PARAM.types}
            value={o.value}
            defaultChecked={filters.types.includes(o.value)}
            onCheckedChange={submitSoon}
          />
        ))}
      </fieldset>

      <Select
        label="Business"
        name={PARAM.businessTypes}
        options={BUSINESS_TYPE_OPTIONS}
        defaultValue={filters.businessTypes[0] ?? null}
        onValueChange={submitSoon}
      />
      <Select
        label="Reason"
        name={PARAM.reasons}
        options={REASON_OPTIONS}
        defaultValue={filters.reasons[0] ?? null}
        onValueChange={submitSoon}
      />
      <MultiCombobox
        label="Neighbourhoods"
        name={PARAM.hoods}
        options={hoodOptions}
        defaultValue={filters.hoods}
        onValueChange={submitSoon}
        placeholder="Any"
      />

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
        <Link
          to={location.pathname}
          onClick={() => {
            window.clearTimeout(timeout.current);
            wroteThisEntry.current = false;
            setQuery("");
          }}
        >
          Clear
        </Link>
      </p>
    </Form>
  );
}

/** Search is controlled, so it is left out of the remount key. */
function controlsSearch(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(PARAM.q);
  return paramsKey(params);
}

function formToParams(form: HTMLFormElement): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of new FormData(form)) {
    if (typeof value !== "string") continue;
    const trimmed = key === PARAM.q ? value.trim() : value;
    if (trimmed !== "") params.append(key, trimmed);
  }
  return params;
}

function paramsKey(params: URLSearchParams): string {
  const sorted = new URLSearchParams(params);
  sorted.sort();
  return sorted.toString();
}
