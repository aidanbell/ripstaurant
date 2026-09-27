import { cn } from "../../utils/cn";

export type PillProps = {
  label: string;
  /** What it's set to, e.g. "Any time" or "Annex +2". */
  summary: string;
  active: boolean;
};

/** A filter button: outlined when unset, filled when it's narrowing the results. */
export function pillClassName(active: boolean) {
  return cn(
    "inline-flex h-10 shrink-0 cursor-default items-center gap-1 rounded-full border border-foreground bg-background px-4 whitespace-nowrap select-none",
    "hover:bg-foreground/10 data-[popup-open]:bg-foreground/10",
    active &&
      "border-primary bg-primary text-background hover:bg-primary/90 data-[popup-open]:bg-primary/90",
  );
}

/**
 * The pill's accessible name carries both ("Why it closed: any", "Rent or lease, Why it
 * closed"), starting with the visible text so voice control users can say what they see.
 */
export function pillLabel({ label, summary, active }: PillProps) {
  return active ? `${summary}, ${label}` : `${label}: ${summary}`;
}
