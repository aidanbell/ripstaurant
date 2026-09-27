import { Slider } from "@base-ui/react/slider";

export type RangeSliderMark = { value: number; label: string };

type RangeSliderProps = {
  label: string;
  min: number;
  max: number;
  step?: number;
  /** [start, end]; controlled, so the caller can derive form values from it. */
  value: readonly [number, number];
  /** While dragging. */
  onValueChange: (value: [number, number]) => void;
  /** When a thumb is released or a key press settles: the moment to act on it. */
  onValueCommitted?: (value: [number, number]) => void;
  /** How a value reads, for the visible range and screen readers. */
  formatValue: (value: number) => string;
  /** Labels under the track, e.g. one per year. */
  marks?: readonly RangeSliderMark[];
  /** Accessible names for the two thumbs. */
  thumbLabels?: readonly [string, string];
};

function pair(value: readonly number[], min: number, max: number) {
  return [value[0] ?? min, value[1] ?? max] as [number, number];
}

/** A two-thumb range slider (Base UI), with the current range shown beside its label. */
export function RangeSlider({
  label,
  min,
  max,
  step = 1,
  value,
  onValueChange,
  onValueCommitted,
  formatValue,
  marks = [],
  thumbLabels = ["Start", "End"],
}: RangeSliderProps) {
  const at = (v: number) => `${((v - min) / (max - min)) * 100}%`;
  return (
    <Slider.Root
      value={value}
      min={min}
      max={max}
      step={step}
      onValueChange={(v) => onValueChange(pair(v, min, max))}
      onValueCommitted={(v) => onValueCommitted?.(pair(v, min, max))}
      className="flex min-w-64 flex-col gap-1"
    >
      <div className="flex justify-between gap-2">
        <Slider.Label>{label}</Slider.Label>
        <span aria-hidden="true">
          {formatValue(value[0])} – {formatValue(value[1])}
        </span>
      </div>
      <Slider.Control className="flex h-6 items-center px-2">
        <Slider.Track className="relative h-1 w-full rounded-full bg-foreground/20">
          <Slider.Indicator className="rounded-full bg-primary" />
          {thumbLabels.map((thumbLabel, index) => (
            <Slider.Thumb
              key={thumbLabel}
              index={index}
              getAriaLabel={() => thumbLabel}
              getAriaValueText={(_formatted, v) => formatValue(v)}
              className="size-4 rounded-full border-2 border-primary bg-background focus-visible:outline-2 focus-visible:outline-accent"
            />
          ))}
        </Slider.Track>
      </Slider.Control>
      {marks.length > 0 && (
        <div className="relative mx-2 h-4 text-xs" aria-hidden="true">
          {marks.map((mark) => (
            <span
              key={mark.value}
              className="absolute -translate-x-1/2"
              style={{ left: at(mark.value) }}
            >
              {mark.label}
            </span>
          ))}
        </div>
      )}
    </Slider.Root>
  );
}
