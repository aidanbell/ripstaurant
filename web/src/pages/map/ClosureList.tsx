import type { ClosureRow } from "@ripstaurant/contract";
import { useEffect, useMemo, useRef } from "react";
import { RestaurantRow } from "../../components/RestaurantRow";
import type { Sort } from "../../filters";
import { cn } from "../../utils/cn";

const SORTS: { value: Sort; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "name", label: "A–Z" },
];

type Props = {
  /** Already filtered, newest first; the map shows the same rows. */
  rows: readonly ClosureRow[];
  /** CityList.hoods: a row's `hood` is an index into it. */
  hoods: readonly string[];
  sort: Sort;
  onSortChange: (sort: Sort) => void;
  onSelect: (id: string) => void;
  /** The closure just closed: its row gets focus back (and scrolls into view). */
  returnTo: string | null;
};

/**
 * The map's closures as a list: beside the map on wide screens, in the sheet on
 * phones. It's the whole site for anyone not using the map, so every row opens its
 * closure. Thousands of rows: `content-visibility: auto` lets the browser skip laying
 * out the ones off screen.
 */
export function ClosureList({
  rows,
  hoods,
  sort,
  onSortChange,
  onSelect,
  returnTo,
}: Props) {
  const list = useRef<HTMLUListElement>(null);
  const sorted = useMemo(
    () =>
      sort === "name"
        ? rows.toSorted((a, b) => a.name.localeCompare(b.name))
        : rows,
    [rows, sort],
  );

  useEffect(() => {
    if (!returnTo) return;
    list.current
      ?.querySelector<HTMLElement>(`[data-closure="${CSS.escape(returnTo)}"]`)
      ?.focus();
  }, [returnTo]);

  return (
    <div className="flex flex-col gap-2">
      <div
        role="group"
        aria-label="Sort"
        className="flex items-center gap-1 self-end text-sm"
      >
        <span aria-hidden="true">Sort:</span>
        {SORTS.map((s) => (
          <button
            key={s.value}
            type="button"
            aria-pressed={sort === s.value}
            onClick={() => onSortChange(s.value)}
            className={cn(
              "h-8 rounded-full px-3",
              sort === s.value && "bg-primary text-background",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>
      {sorted.length ? (
        <ul ref={list} className="flex flex-col gap-2">
          {sorted.map((row) => (
            <li
              key={row.id}
              className="[contain-intrinsic-size:auto_5.5rem] [content-visibility:auto]"
            >
              <RestaurantRow
                row={row}
                hood={hoods[row.hood] ?? ""}
                selected={row.id === returnTo}
                onSelect={onSelect}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p>No closures match these filters.</p>
      )}
    </div>
  );
}
