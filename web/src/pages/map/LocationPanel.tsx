import type { LocationDetail } from "@ripstaurant/contract";
import { ArrowLeftIcon } from "@heroicons/react/20/solid";
import { useEffect, useRef } from "react";
import { HistoryCarousel } from "./HistoryCarousel";

type Props = {
  detail: LocationDetail;
  /** The selected closure: its card is the one the history opens on. */
  closureId: string;
  /** Back to the list (clears the selection). */
  onClose: () => void;
};

/**
 * A selected closure's address, in place of the list: where it is, and everyone who's
 * been there. Focus moves to the address when it opens; Escape or the back button
 * returns to the list.
 */
export function LocationPanel({ detail, closureId, onClose }: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  const start = openingCard(detail, closureId);

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [detail.id]);

  return (
    <article
      className="flex flex-col gap-3"
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <button
        type="button"
        onClick={onClose}
        className="flex h-9 items-center gap-1 self-start underline underline-offset-2"
      >
        <ArrowLeftIcon className="size-4" aria-hidden="true" />
        Back to the list
      </button>
      <header>
        <h2
          ref={heading}
          tabIndex={-1}
          className="text-xl font-bold outline-none"
        >
          {detail.addr}
        </h2>
        <p>{detail.hood}</p>
      </header>
      <HistoryCarousel
        key={`${detail.id}/${closureId}`}
        detail={detail}
        start={start}
      />
    </article>
  );
}

/** The selected closure's occupant; failing that, the latest that closed, or the latest. */
function openingCard(detail: LocationDetail, closureId: string): number {
  const { occupants } = detail;
  const exact = occupants.findIndex((o) => o.event?.id === closureId);
  if (exact !== -1) return exact;
  const closed = occupants.findLastIndex((o) => o.event);
  return closed !== -1 ? closed : occupants.length - 1;
}
