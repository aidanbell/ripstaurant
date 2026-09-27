import type { ClosureRow } from "@ripstaurant/contract";
import { ChevronRightIcon } from "@heroicons/react/20/solid";
import { describeClosure } from "../format";
import { EVENT_TYPE_LABELS } from "../labels";
import { cn } from "../utils/cn";

type Props = {
  row: ClosureRow;
  /** The neighbourhood's name (the row has its index into CityList.hoods). */
  hood: string;
  /** This row's closure is the one open beside the map. */
  selected: boolean;
  onSelect: (id: string) => void;
};

/**
 * One closure in the list. The whole card is a button: it opens the closure's address
 * (its history, its sources) in place of the list, and flies the map there. Only one is
 * ever open, since the selection lives in the URL.
 */
export function RestaurantRow({ row, hood, selected, onSelect }: Props) {
  return (
    <button
      type="button"
      data-closure={row.id}
      aria-current={selected || undefined}
      onClick={() => onSelect(row.id)}
      className={cn(
        "flex w-full items-center gap-2 rounded-md border border-foreground/30 p-3 text-left hover:border-foreground",
        selected && "border-foreground",
      )}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-bold">{row.name}</span>
        <span className="text-sm">
          {row.addr} · <span className="text-secondary">{hood}</span>
        </span>
        <span className="text-sm">
          {EVENT_TYPE_LABELS[row.type]} ·{" "}
          {describeClosure(row.d, row.status, "short")}
        </span>
      </span>
      <ChevronRightIcon className="size-5 shrink-0" aria-hidden="true" />
    </button>
  );
}
