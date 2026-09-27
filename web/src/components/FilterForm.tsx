import { CheckboxGroup } from "@base-ui/react/checkbox-group";
import { Input } from "@base-ui/react/input";
import { MagnifyingGlassIcon } from "@heroicons/react/20/solid";
import { DEFAULT_VISIBLE_TYPES } from "@ripstaurant/contract";
import type { CityList } from "@ripstaurant/contract";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { useLocation, useNavigationType, useSearchParams } from "react-router";
import { PARAM } from "../filters";
import type { Filters } from "../filters";
import {
  BUSINESS_TYPE_OPTIONS,
  EVENT_TYPE_OPTIONS,
  REASON_OPTIONS,
} from "../labels";
import type { Option } from "../labels";
import { describeClosedBetween } from "../format";
import { ClosedBetween } from "./ClosedBetween";
import { Checkbox } from "./ui/checkbox";
import { MultiCombobox } from "./ui/combobox";
import { FilterPopover } from "./ui/filter-popover";

type Props = {
  list: CityList;
  filters: Filters;
  /** How many closures pass the filters, announced as it changes. */
  shown: number;
};

const SEARCH_DEBOUNCE_MS = 250;
const COUNT = new Intl.NumberFormat("en-CA");

/**
 * The filter bar, for /map and /list: a search box, then a pill per filter that opens
 * its controls. The URL's search params are the filters, and every control reads its
 * value from them, so Back/Forward, shared links and clicks on the map all show up
 * here. Changes apply straight away; the search box waits briefly so typing doesn't
 * navigate on every key. The first change in a visit pushes a history entry, further
 * changes replace it, so Back leaves the filtered view.
 *
 * The pills scroll sideways on narrow screens; they work the same inside a drawer.
 */
export function FilterForm({ list, filters, shown }: Props) {
  const location = useLocation();
  const navigationType = useNavigationType();
  const [, setParams] = useSearchParams();
  const searchRef = useRef<HTMLInputElement>(null);
  const wroteThisEntry = useRef(false);
  const [query, setQuery] = useState(filters.q);
  const [historyKey, setHistoryKey] = useState(location.key);
  const hoodOptions = useMemo(
    () => list.hoods.map((hood) => ({ value: hood, label: hood })),
    [list.hoods],
  );

  // Back/Forward: show that entry's search, and start a new history entry next change.
  if (historyKey !== location.key) {
    setHistoryKey(location.key);
    if (navigationType === "POP") setQuery(filters.q);
  }
  useEffect(() => {
    if (navigationType === "POP") wroteThisEntry.current = false;
  }, [location.key, navigationType]);

  /** Applies `change` to the current URL's params and navigates, if anything changed. */
  function commit(change: (params: URLSearchParams) => void) {
    const current = new URLSearchParams(location.search);
    const next = new URLSearchParams(current);
    change(next);
    if (paramsKey(next) === paramsKey(current)) return;
    const replace = wroteThisEntry.current;
    wroteThisEntry.current = true;
    setParams(next, { replace, preventScrollReset: true });
  }

  function setAll(param: string, values: readonly string[]) {
    commit((params) => {
      params.delete(param);
      for (const value of values) params.append(param, value);
    });
  }

  function commitQuery(value: string) {
    const trimmed = value.trim();
    setAll(PARAM.q, trimmed ? [trimmed] : []);
  }
  // Reads the URL when the timer fires, so a filter changed meanwhile isn't undone.
  const commitQuerySoon = useEffectEvent(commitQuery);
  useEffect(() => {
    const timeout = window.setTimeout(
      () => commitQuerySoon(query),
      SEARCH_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [query]);

  const typesActive = !sameSet(filters.types, DEFAULT_VISIBLE_TYPES);
  const whenActive = filters.from !== null || filters.to !== null;
  const anyActive =
    filters.q !== "" ||
    typesActive ||
    filters.businessTypes.length > 0 ||
    filters.reasons.length > 0 ||
    filters.hoods.length > 0 ||
    whenActive;

  function clearAll() {
    setQuery("");
    commit((params) => {
      for (const param of Object.values(PARAM)) params.delete(param);
    });
    // The button goes away once nothing's set: keep focus somewhere useful.
    searchRef.current?.focus();
  }

  return (
    <search className="flex flex-col gap-2">
      <form
        className="relative w-full sm:max-w-80"
        onSubmit={(event) => {
          event.preventDefault();
          commitQuery(query);
        }}
      >
        <label htmlFor="closure-search" className="sr-only">
          Search by name or address
        </label>
        <MagnifyingGlassIcon
          className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2"
          aria-hidden="true"
        />
        <Input
          id="closure-search"
          ref={searchRef}
          type="search"
          placeholder="Search a name or street"
          value={query}
          onValueChange={setQuery}
          className="h-10 w-full rounded-full border border-foreground bg-background pr-3 pl-10 placeholder:text-foreground/70"
        />
      </form>

      <div
        role="group"
        aria-label="Filters"
        className="flex gap-2 overflow-x-auto p-1 sm:flex-wrap sm:overflow-visible"
      >
        <FilterPopover
          label="What happened"
          summary={summarize(labelsOf(EVENT_TYPE_OPTIONS, filters.types), "")}
          active={typesActive}
          onReset={() => setAll(PARAM.types, [])}
        >
          <CheckboxGroup
            aria-label="What happened"
            value={filters.types}
            onValueChange={(types) =>
              setAll(
                PARAM.types,
                sameSet(types, DEFAULT_VISIBLE_TYPES) ? [] : types,
              )
            }
            className="flex flex-col"
          >
            {EVENT_TYPE_OPTIONS.map((o) => (
              <Checkbox
                key={o.value}
                label={o.label}
                value={o.value}
                // At least one has to stay on; with none, the defaults would come back.
                disabled={
                  filters.types.length === 1 && filters.types[0] === o.value
                }
              />
            ))}
          </CheckboxGroup>
        </FilterPopover>

        <MultiCombobox
          label="Neighbourhood"
          summary={summarize(filters.hoods, "Anywhere")}
          options={hoodOptions}
          value={filters.hoods}
          onValueChange={(hoods) => setAll(PARAM.hoods, hoods)}
          placeholder="Search neighbourhoods"
          empty="No neighbourhood by that name."
        />

        <FilterPopover
          label="When"
          summary={describeClosedBetween(filters.from, filters.to)}
          active={whenActive}
          onReset={() =>
            commit((params) => {
              params.delete(PARAM.from);
              params.delete(PARAM.to);
            })
          }
        >
          <ClosedBetween
            since={list.since}
            until={list.generated}
            from={filters.from}
            to={filters.to}
            onCommit={(from, to) =>
              commit((params) => {
                params.delete(PARAM.from);
                params.delete(PARAM.to);
                if (from) params.set(PARAM.from, from);
                if (to) params.set(PARAM.to, to);
              })
            }
          />
        </FilterPopover>

        <FilterPopover
          label="Kind of place"
          summary={summarize(
            labelsOf(BUSINESS_TYPE_OPTIONS, filters.businessTypes),
            "Any kind",
          )}
          active={filters.businessTypes.length > 0}
          onReset={() => setAll(PARAM.businessTypes, [])}
        >
          <CheckboxGroup
            aria-label="Kind of place"
            value={filters.businessTypes}
            onValueChange={(values) => setAll(PARAM.businessTypes, values)}
            className="flex flex-col"
          >
            {BUSINESS_TYPE_OPTIONS.map((o) => (
              <Checkbox key={o.value} label={o.label} value={o.value} />
            ))}
          </CheckboxGroup>
        </FilterPopover>

        <FilterPopover
          label="Why it closed"
          summary={summarize(
            labelsOf(REASON_OPTIONS, filters.reasons),
            "Any reason",
          )}
          active={filters.reasons.length > 0}
          onReset={() => setAll(PARAM.reasons, [])}
        >
          <p className="text-sm">
            Most closures don't say why. We only know when there's a public
            record of it.
          </p>
          <CheckboxGroup
            aria-label="Why it closed"
            value={filters.reasons}
            onValueChange={(values) => setAll(PARAM.reasons, values)}
            className="flex flex-col"
          >
            {REASON_OPTIONS.map((o) => (
              <Checkbox key={o.value} label={o.label} value={o.value} />
            ))}
          </CheckboxGroup>
        </FilterPopover>

        {anyActive && (
          <button
            type="button"
            onClick={clearAll}
            className="h-10 shrink-0 px-2 whitespace-nowrap underline underline-offset-2"
          >
            Clear all
          </button>
        )}
      </div>

      <p role="status" className="text-sm">
        {anyActive
          ? `${COUNT.format(shown)} of ${COUNT.format(list.closures.length)} closures`
          : `${COUNT.format(list.closures.length)} closures`}
      </p>
    </search>
  );
}

/** Labels for the picked values, in the options' order. */
function labelsOf<T extends string>(
  options: readonly Option<T>[],
  values: readonly string[],
): string[] {
  return options.filter((o) => values.includes(o.value)).map((o) => o.label);
}

/** ["Annex"] → "Annex"; ["Annex", "Casa Loma", "Leaside"] → "Annex +2" */
function summarize(labels: readonly string[], none: string): string {
  const [first] = labels;
  if (first === undefined) return none;
  return labels.length === 1 ? first : `${first} +${labels.length - 1}`;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v) => b.includes(v));
}

function paramsKey(params: URLSearchParams): string {
  const sorted = new URLSearchParams(params);
  sorted.sort();
  return sorted.toString();
}
