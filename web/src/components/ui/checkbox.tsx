import { Checkbox as BaseCheckbox } from "@base-ui/react/checkbox";
import type { ReactNode } from "react";

type CheckboxProps = {
  label: ReactNode;
  /** Form field name; a checked box submits `value`, like a native checkbox. */
  name?: string;
  value?: string;
  defaultChecked?: boolean;
  checked?: boolean;
  /**
   * Called when the box is toggled. Base UI updates its hidden form input itself, so a
   * form's native `change` event never fires; wire form-level reactions here instead.
   */
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
};

/** A labelled checkbox (Base UI). The whole label toggles it. */
export function Checkbox({ label, ...props }: CheckboxProps) {
  return (
    <label className="inline-flex min-h-9 items-center gap-2">
      <BaseCheckbox.Root
        {...props}
        className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm border border-foreground data-[checked]:bg-primary data-[checked]:text-background data-[disabled]:opacity-50"
      >
        <BaseCheckbox.Indicator>
          <svg viewBox="0 0 12 12" className="size-3" aria-hidden="true">
            <path
              d="M2 6.5 5 9l5-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            />
          </svg>
        </BaseCheckbox.Indicator>
      </BaseCheckbox.Root>
      {label}
    </label>
  );
}
