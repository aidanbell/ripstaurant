import type { LocationDetail, Occupant } from "@ripstaurant/contract";
import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/20/solid";
import { useId, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { describeClosure, describeStay } from "../../format";
import {
  BUSINESS_TYPE_LABELS,
  EVENT_TYPE_LABELS,
  REASON_LABELS,
} from "../../labels";
import { cn } from "../../utils/cn";

type Props = {
  detail: LocationDetail;
  /** The card to open on (an index into `detail.occupants`). */
  start: number;
};

/**
 * Everyone who's been at an address, oldest first, one card each: swipe or scroll
 * through them (CSS scroll snap), or use the arrows, the arrow keys, or the dots
 * underneath, which also show where you are in the address's timeline. The next and
 * previous cards peek in at the sides.
 */
export function HistoryCarousel({ detail, start }: Props) {
  const titleId = useId();
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(start);
  const { occupants } = detail;
  const last = occupants.length - 1;
  const current = occupants[index];

  function cardAt(i: number): HTMLElement | null {
    const card = track.current?.children[i];
    return card instanceof HTMLElement ? card : null;
  }

  /** Scrolls card `i` to the middle; smoothly, unless reduced motion (CSS). */
  function go(i: number) {
    const target = Math.max(0, Math.min(last, i));
    const card = cardAt(target);
    const t = track.current;
    if (!card || !t) return;
    t.scrollTo({
      left: card.offsetLeft - (t.clientWidth - card.clientWidth) / 2,
    });
    setIndex(target);
  }

  // Open on `start` without animating there.
  useLayoutEffect(() => {
    const card = cardAt(start);
    const t = track.current;
    if (!card || !t) return;
    t.scrollTo({
      left: card.offsetLeft - (t.clientWidth - card.clientWidth) / 2,
      behavior: "instant",
    });
  }, [start]);

  /** After a swipe or scroll: the card nearest the middle is the current one. */
  function onScroll() {
    const t = track.current;
    if (!t) return;
    const middle = t.scrollLeft + t.clientWidth / 2;
    let nearest = 0;
    let distance = Infinity;
    for (let i = 0; i <= last; i++) {
      const card = cardAt(i);
      if (!card) continue;
      const d = Math.abs(card.offsetLeft + card.clientWidth / 2 - middle);
      if (d < distance) [nearest, distance] = [i, d];
    }
    if (nearest !== index) setIndex(nearest);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "ArrowLeft") go(index - 1);
    else if (event.key === "ArrowRight") go(index + 1);
    else return;
    event.preventDefault();
  }

  return (
    <section
      aria-roledescription="carousel"
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
      className="flex flex-col gap-2"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 id={titleId} className="font-bold">
          {occupants.length === 1
            ? "Who was here"
            : `Who's been here (${occupants.length})`}
        </h3>
        {last > 0 && (
          <div className="flex gap-1">
            <button
              type="button"
              aria-label="Earlier"
              // aria-disabled, not disabled: a disabled button drops focus at the ends.
              aria-disabled={index === 0}
              onClick={() => go(index - 1)}
              className="grid size-9 place-items-center rounded-full border border-foreground aria-disabled:opacity-30"
            >
              <ChevronLeftIcon className="size-5" aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Later"
              aria-disabled={index === last}
              onClick={() => go(index + 1)}
              className="grid size-9 place-items-center rounded-full border border-foreground aria-disabled:opacity-30"
            >
              <ChevronRightIcon className="size-5" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      <div
        ref={track}
        onScroll={onScroll}
        className="flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain [scrollbar-width:none] motion-safe:scroll-smooth"
      >
        {occupants.map((o, i) => (
          <div
            key={`${o.name}-${o.from ?? i}`}
            role="group"
            aria-roledescription="slide"
            aria-label={`${i + 1} of ${occupants.length}: ${o.name}`}
            className={cn(
              "w-[85%] shrink-0 snap-center rounded-md border border-foreground p-4 transition-opacity",
              last === 0 && "w-full",
              i !== index && "opacity-50",
            )}
          >
            <OccupantCard occupant={o} detail={detail} />
          </div>
        ))}
      </div>

      {last > 0 && (
        <nav aria-label="Timeline" className="flex flex-col gap-1">
          <ol className="flex flex-wrap justify-center">
            {occupants.map((o, i) => (
              <li key={`${o.name}-${o.from ?? i}`}>
                <button
                  type="button"
                  aria-label={`${o.name}, ${describeStay(o.from, o.to)}`}
                  aria-current={i === index ? "step" : undefined}
                  onClick={() => go(i)}
                  className="grid size-6 place-items-center"
                >
                  <span
                    className={cn(
                      "size-2 rounded-full border border-foreground",
                      i === index && "size-2.5 bg-foreground",
                      i !== index && o.event && "bg-accent border-accent",
                    )}
                  />
                </button>
              </li>
            ))}
          </ol>
          <p className="flex justify-between text-xs" aria-hidden="true">
            <span>{year(occupants[0]?.from)}</span>
            <span>
              {occupants[last]?.to ? year(occupants[last]?.to) : "Now"}
            </span>
          </p>
        </nav>
      )}
      <p className="sr-only" aria-live="polite">
        {current && `${index + 1} of ${occupants.length}: ${current.name}`}
      </p>
    </section>
  );
}

function year(iso: string | null | undefined): string {
  return iso?.slice(0, 4) ?? "";
}

/** One business's time here: when, what happened at the end, why, and the sources. */
function OccupantCard({
  occupant: o,
  detail,
}: {
  occupant: Occupant;
  detail: LocationDetail;
}) {
  const event = o.event;
  const sources = [
    ...new Set([
      ...o.src,
      ...(event?.evidence.map((e) => e.src) ?? []),
      ...(event?.reasons.flatMap((r) => r.src) ?? []),
    ]),
  ].flatMap((i) => detail.sources[i] ?? []);

  return (
    <div className="flex flex-col gap-2">
      <div>
        <h4 className="text-lg font-bold">{o.name}</h4>
        <p className="text-sm">
          {o.bt && BUSINESS_TYPE_LABELS[o.bt]}
          {o.bt && o.chain && " · "}
          {o.chain && "Chain"}
        </p>
      </div>
      <p>Here {describeStay(o.from, o.to)}</p>
      {event ? (
        <EventSummary event={event} />
      ) : (
        o.to === null && <p>Still here</p>
      )}
      {sources.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-default">
            Sources ({sources.length})
          </summary>
          <ul className="mt-1 flex flex-col gap-1">
            {sources.map((s) => (
              <li key={s.url}>
                <a href={s.url}>{s.title}</a>, {s.publisher}
                {s.date && `, ${s.date}`}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function EventSummary({ event }: { event: NonNullable<Occupant["event"]> }) {
  return (
    <div className="flex flex-col gap-1 border-l-2 border-accent pl-3">
      <p className="font-medium">{EVENT_TYPE_LABELS[event.type]}</p>
      <p className="text-sm">{describeClosure(event.d, event.status)}</p>
      {event.next && <p className="text-sm">{describeNext(event)}</p>}
      {event.reasons.map((r) => (
        <p key={r.code} className="text-sm">
          Why: {REASON_LABELS[r.code]}
          {r.summary && `. ${r.summary}`}
        </p>
      ))}
    </div>
  );
}

function describeNext(event: NonNullable<Occupant["event"]>): string {
  const next = event.next;
  if (!next) return "";
  if (event.type === "relocated")
    return `Moved to ${next.addr ?? "a new address"}`;
  return `Followed by ${next.name}`;
}
