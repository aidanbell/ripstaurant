import type { ClosureRow, DateRange } from "@ripstaurant/contract";
import { displayDateFromRange } from "../utils/date";
import { ChevronDownIcon } from "@heroicons/react/24/outline";
import { useState } from "react";
import { cn } from "../utils/cn";

function ClosureWhen({ range }: { range: DateRange }) {
  const { verb, date } = displayDateFromRange(range);
  if (!date) return verb;
  if (!verb) return <span className="font-bold">{date}</span>;
  return (
    <>
      {verb} <span className="font-bold">{date}</span>
    </>
  );
}

type Props = {
  row: ClosureRow;
  /** The neighbourhood's name (the row has its index into CityList.hoods). */
  hood: string;
};

export function RestaurantRow({ row, hood }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-4 border rounded-md p-4 drop-shadow-md hover:drop-shadow-lg transition-all duration-300">
      <h2
        className="flex flex-row gap-2 items-center justify-between"
        onClick={() => setOpen(!open)}
      >
        {row.name}
        <ChevronDownIcon className={cn("w-4 h-4", open ? "rotate-180" : "")} />
      </h2>
      {open && (
        <>
          <div className="flex flex-row gap-4">
            <p className="text-sm text-secondary">{row.addr}</p>
            <p className="text-sm font-bold text-accent">{hood}</p>
          </div>
          <p>{row.type}</p>
          <p>{row.rs}</p>
          <p>
            <ClosureWhen range={row.d} />
          </p>
        </>
      )}
    </div>
  );
}
