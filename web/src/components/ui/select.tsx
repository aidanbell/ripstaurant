import { Select as BaseSelect } from "@base-ui/react/select";
import { useMemo } from "react";
import type { ComboboxOption as SelectOption } from "./combobox";

type SelectProps = {
  label: string;
  options: readonly SelectOption[];
  /** Form field name; submits the selected `value`, or nothing for `anyLabel`. */
  name?: string;
  /** Selected value; null for none. Uncontrolled: remount to reset. */
  defaultValue?: string | null;
  /**
   * Called with the selected value (null for none). Base UI updates its hidden form
   * input itself, so a form's native `change` event never fires; wire reactions here.
   */
  onValueChange?: (value: string | null) => void;
  /** The "no selection" choice, first in the list. */
  anyLabel?: string;
};

/** A single-choice dropdown (Base UI), with a "no selection" choice first. */
export function Select({
  label,
  options,
  name,
  defaultValue = null,
  onValueChange,
  anyLabel = "Any",
}: SelectProps) {
  const items = useMemo(
    () => [{ value: null, label: anyLabel }, ...options],
    [options, anyLabel],
  );

  return (
    <BaseSelect.Root
      items={items}
      name={name}
      defaultValue={defaultValue}
      onValueChange={(value: string | null) => onValueChange?.(value)}
    >
      <div className="flex flex-col gap-1">
        <BaseSelect.Label>{label}</BaseSelect.Label>
        <BaseSelect.Trigger className="inline-flex min-w-40 items-center justify-between gap-2 rounded-sm border border-foreground bg-background px-2 py-1">
          <BaseSelect.Value />
          <BaseSelect.Icon aria-hidden="true">▾</BaseSelect.Icon>
        </BaseSelect.Trigger>
      </div>
      <BaseSelect.Portal>
        <BaseSelect.Positioner sideOffset={4} alignItemWithTrigger={false}>
          <BaseSelect.Popup className="max-h-72 min-w-(--anchor-width) overflow-y-auto rounded-sm border border-foreground bg-background py-1 text-foreground">
            <BaseSelect.List>
              {items.map((o) => (
                <BaseSelect.Item
                  key={o.value ?? ""}
                  value={o.value}
                  className="flex cursor-default items-center gap-2 px-2 py-0.5 data-[highlighted]:bg-primary data-[highlighted]:text-background"
                >
                  <span className="w-3">
                    <BaseSelect.ItemIndicator>✓</BaseSelect.ItemIndicator>
                  </span>
                  <BaseSelect.ItemText>{o.label}</BaseSelect.ItemText>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
