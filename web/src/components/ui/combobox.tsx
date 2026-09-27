import { Combobox } from "@base-ui/react/combobox";
import { CheckIcon } from "@heroicons/react/20/solid";
import { useMemo } from "react";
import { PillText } from "./filter-popover";
import { pillClassName, pillLabel } from "./pill";

export type ComboboxOption = { value: string; label: string };

type MultiComboboxProps = {
  label: string;
  /** What's picked, for the pill: "Anywhere", "Annex +2". */
  summary: string;
  options: readonly ComboboxOption[];
  /** Selected values (not labels). Controlled. */
  value: readonly string[];
  onValueChange: (values: string[]) => void;
  placeholder?: string;
  empty?: string;
};

/**
 * A filter pill that opens a searchable list: type to narrow it, pick several. For long
 * option lists (neighbourhoods), where checkboxes would be unscannable. The list stays
 * open between picks.
 */
export function MultiCombobox({
  label,
  summary,
  options,
  value,
  onValueChange,
  placeholder,
  empty = "No matches.",
}: MultiComboboxProps) {
  const selected = useMemo(
    () => options.filter((o) => value.includes(o.value)),
    [options, value],
  );
  const active = selected.length > 0;

  return (
    <Combobox.Root
      items={options}
      multiple
      value={selected}
      onValueChange={(next: ComboboxOption[]) =>
        onValueChange(next.map((o) => o.value))
      }
    >
      <Combobox.Trigger
        aria-label={pillLabel({ label, summary, active })}
        className={pillClassName(active)}
      >
        <PillText label={label} summary={summary} active={active} />
      </Combobox.Trigger>
      <Combobox.Portal>
        <Combobox.Positioner align="start" sideOffset={6} collisionPadding={16}>
          <Combobox.Popup
            aria-label={label}
            className="flex w-80 max-w-(--available-width) flex-col rounded-md border border-foreground bg-background text-foreground shadow-lg"
          >
            <div className="p-2">
              <Combobox.Input
                aria-label={placeholder ?? label}
                placeholder={placeholder}
                className="h-10 w-full rounded-sm border border-foreground bg-background px-3 placeholder:text-foreground/70"
              />
            </div>
            <Combobox.Empty className="px-3 pb-3 empty:hidden">
              {empty}
            </Combobox.Empty>
            <Combobox.List className="max-h-[min(20rem,calc(var(--available-height)-4rem))] overflow-y-auto overscroll-contain pb-1 empty:hidden">
              {(o: ComboboxOption) => (
                <Combobox.Item
                  key={o.value}
                  value={o}
                  className="flex min-h-10 cursor-default items-center gap-2 px-3 data-[highlighted]:bg-primary data-[highlighted]:text-background"
                >
                  <span className="w-4 shrink-0">
                    <Combobox.ItemIndicator>
                      <CheckIcon className="size-4" aria-hidden="true" />
                    </Combobox.ItemIndicator>
                  </span>
                  {o.label}
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
