import { Combobox } from "@base-ui/react/combobox";
import { useId, useMemo } from "react";

export type ComboboxOption = { value: string; label: string };

type MultiComboboxProps = {
  label: string;
  options: readonly ComboboxOption[];
  /** Form field name; each selected option submits its `value` under it (repeated). */
  name?: string;
  /** Selected values (not labels). Uncontrolled: remount to reset. */
  defaultValue?: readonly string[];
  /**
   * Called with the selected values. Base UI updates its hidden form inputs itself, so a
   * form's native `change` event never fires; wire form-level reactions here instead.
   */
  onValueChange?: (values: string[]) => void;
  placeholder?: string;
  empty?: string;
};

/**
 * Type to filter, pick several; picks show as removable chips. For long option lists
 * (neighbourhoods), where checkboxes would be unscannable.
 */
export function MultiCombobox({
  label,
  options,
  name,
  defaultValue = [],
  onValueChange,
  placeholder,
  empty = "No matches.",
}: MultiComboboxProps) {
  const id = useId();
  const initial = useMemo(
    () => options.filter((o) => defaultValue.includes(o.value)),
    [options, defaultValue],
  );

  return (
    <Combobox.Root
      items={options}
      multiple
      name={name}
      defaultValue={initial}
      onValueChange={(selected: ComboboxOption[]) =>
        onValueChange?.(selected.map((o) => o.value))
      }
    >
      <div className="flex flex-col gap-1">
        <label htmlFor={id}>{label}</label>
        <Combobox.InputGroup className="flex min-w-60 flex-wrap items-center gap-1 rounded-sm border border-foreground bg-background p-1 focus-within:outline-2 focus-within:outline-accent">
          <Combobox.Value>
            {(selected: ComboboxOption[]) => (
              <Combobox.Chips className="flex flex-wrap items-center gap-1">
                {selected.map((o) => (
                  <Combobox.Chip
                    key={o.value}
                    className="inline-flex items-center gap-1 rounded-sm bg-primary px-1.5 text-sm text-background"
                  >
                    {o.label}
                    <Combobox.ChipRemove aria-label={`Remove ${o.label}`}>
                      ×
                    </Combobox.ChipRemove>
                  </Combobox.Chip>
                ))}
                <Combobox.Input
                  id={id}
                  placeholder={selected.length ? undefined : placeholder}
                  className="min-w-24 flex-1 bg-transparent outline-none"
                />
              </Combobox.Chips>
            )}
          </Combobox.Value>
        </Combobox.InputGroup>
      </div>

      <Combobox.Portal>
        <Combobox.Positioner sideOffset={4}>
          <Combobox.Popup className="max-h-72 min-w-(--anchor-width) overflow-y-auto rounded-sm border border-foreground bg-background py-1 text-foreground">
            <Combobox.Empty className="px-2 py-1">{empty}</Combobox.Empty>
            <Combobox.List>
              {(o: ComboboxOption) => (
                <Combobox.Item
                  key={o.value}
                  value={o}
                  className="flex cursor-default items-center gap-2 px-2 py-0.5 data-[highlighted]:bg-primary data-[highlighted]:text-background"
                >
                  <span className="w-3">
                    <Combobox.ItemIndicator>✓</Combobox.ItemIndicator>
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
