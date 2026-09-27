import { Popover } from "@base-ui/react/popover";
import { ChevronDownIcon } from "@heroicons/react/20/solid";
import type { ReactNode } from "react";
import { pillClassName, pillLabel } from "./pill";
import type { PillProps } from "./pill";

/** The pill's text: its label while unset, what it's set to once it is. */
export function PillText({ label, summary, active }: PillProps) {
  return (
    <>
      <span>{active ? summary : label}</span>
      <ChevronDownIcon className="size-4" aria-hidden="true" />
    </>
  );
}

type FilterPopoverProps = PillProps & {
  /** Puts this filter back to its default. */
  onReset: () => void;
  children: ReactNode;
};

/**
 * A pill that opens its filter's controls (Base UI Popover). Changes apply as they're
 * made, so the results update behind it; Done, Escape or a click outside closes it,
 * and focus goes back to the pill.
 */
export function FilterPopover({
  label,
  summary,
  active,
  onReset,
  children,
}: FilterPopoverProps) {
  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label={pillLabel({ label, summary, active })}
        className={pillClassName(active)}
      >
        <PillText label={label} summary={summary} active={active} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} align="start" collisionPadding={16}>
          <Popover.Popup className="flex w-80 max-w-(--available-width) flex-col gap-3 rounded-md border border-foreground bg-background p-4 text-foreground shadow-lg outline-none">
            <Popover.Title className="font-bold">{label}</Popover.Title>
            {children}
            <div className="flex justify-between gap-2 border-t border-foreground/20 pt-3">
              <button
                type="button"
                onClick={onReset}
                className="underline underline-offset-2"
              >
                Reset
              </button>
              <Popover.Close className="rounded-full bg-primary px-4 py-1.5 text-background">
                Done
              </Popover.Close>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
