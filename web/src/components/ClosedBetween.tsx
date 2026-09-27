import { useMemo, useState } from "react";
import { RangeSlider } from "./ui/range-slider";

type Quarter = {
  /** "Q2 2023" */
  label: string;
  year: number;
  /** First and last day, as ISO dates. */
  start: string;
  end: string;
};

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Every calendar quarter from the one containing `since` to the one containing `until`. */
function quartersBetween(since: string, until: string): Quarter[] {
  const quarters: Quarter[] = [];
  const last = new Date(until);
  const lastIndex =
    last.getUTCFullYear() * 4 + Math.floor(last.getUTCMonth() / 3);
  const first = new Date(since);
  for (
    let i = first.getUTCFullYear() * 4 + Math.floor(first.getUTCMonth() / 3);
    i <= lastIndex;
    i++
  ) {
    const year = Math.floor(i / 4);
    const q = i % 4;
    quarters.push({
      label: `Q${q + 1} ${year}`,
      year,
      start: iso(new Date(Date.UTC(year, q * 3, 1))),
      end: iso(new Date(Date.UTC(year, q * 3 + 3, 0))),
    });
  }
  return quarters;
}

/** The quarter containing an ISO date, clamped to the range. */
function quarterOf(quarters: Quarter[], date: string | null, fallback: number) {
  if (!date) return fallback;
  const i = quarters.findIndex((q) => date >= q.start && date <= q.end);
  if (i !== -1) return i;
  return date < (quarters[0]?.start ?? "") ? 0 : quarters.length - 1;
}

type Props = {
  /** Start of the coverage window (CityList.since). */
  since: string;
  /** When the data was exported (CityList.generated): the last quarter shown. */
  until: string;
  from: string | null;
  to: string | null;
  /**
   * A thumb was released, or a key press settled: the new range as ISO dates (a
   * quarter's first day, its last), null at either end of the full range.
   */
  onCommit: (from: string | null, to: string | null) => void;
};

/**
 * "Closed between" as a quarter-by-quarter range slider, year labels underneath.
 * Closure dates are mostly ranges known to within months, so days would be false
 * precision. The URL keeps ISO dates, so filters and shared links don't depend on it.
 * It follows `from`/`to` when they change from outside (Reset, Back).
 */
export function ClosedBetween({ since, until, from, to, onCommit }: Props) {
  const quarters = useMemo(() => quartersBetween(since, until), [since, until]);
  const last = quarters.length - 1;
  const committed: [number, number] = [
    quarterOf(quarters, from, 0),
    quarterOf(quarters, to, last),
  ];
  const [range, setRange] = useState(committed);
  const [synced, setSynced] = useState(committed);
  if (committed[0] !== synced[0] || committed[1] !== synced[1]) {
    setSynced(committed);
    setRange(committed);
  }
  const marks = useMemo(
    () =>
      quarters.flatMap((q, i) =>
        i === 0 || q.label.startsWith("Q1")
          ? [{ value: i, label: String(q.year) }]
          : [],
      ),
    [quarters],
  );

  return (
    <RangeSlider
      label="Closed between"
      min={0}
      max={last}
      value={range}
      onValueChange={setRange}
      onValueCommitted={([start, end]) =>
        onCommit(
          start > 0 ? (quarters[start]?.start ?? null) : null,
          end < last ? (quarters[end]?.end ?? null) : null,
        )
      }
      formatValue={(i) => quarters[i]?.label ?? ""}
      marks={marks}
      thumbLabels={["From", "To"]}
    />
  );
}
