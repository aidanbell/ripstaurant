import { Drawer } from "@base-ui/react/drawer";
import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { MIDDLE_REM, PEEK_REM } from "./sheet";

const PEEK = `${PEEK_REM}rem`;
const MIDDLE = `${MIDDLE_REM}rem`;
const FULL = 1;
const SNAP_POINTS = [PEEK, MIDDLE, FULL];

type Props = {
  title: string;
  /** The button's label while the sheet is down: "Show the list". */
  showLabel: string;
  /**
   * Changes when something's selected: the sheet moves to its middle stop, showing it
   * with the map above.
   */
  raiseFor: string | null;
  /** Changes when the content does, so it starts scrolled to the top. */
  contentKey: string;
  children: ReactNode;
};

/**
 * The list on phones: a bottom sheet over the map (Base UI Drawer) that's always there.
 * Drag it between a peek, a middle stop and full height, or use the button, which does the same
 * for anyone who can't drag. It's non-modal, so the map above it stays usable, and it
 * can't be dismissed: swiping it down past the peek settles it there.
 */
export function ClosureSheet({
  title,
  showLabel,
  raiseFor,
  contentKey,
  children,
}: Props) {
  const [snapPoint, setSnapPoint] = useState<Drawer.Root.SnapPoint | null>(
    raiseFor ? MIDDLE : PEEK,
  );
  const [raisedFor, setRaisedFor] = useState(raiseFor);
  if (raiseFor !== raisedFor) {
    setRaisedFor(raiseFor);
    if (raiseFor) setSnapPoint(MIDDLE);
  }
  // The sheet is always full height (below the nav) and slides down to each stop; a
  // sheet sized to its content would put the stops in the wrong place when it's short.
  /** A swipe just tried to dismiss the sheet (see onOpenChange). */
  const dismissed = useRef(false);
  const expanded = snapPoint !== PEEK;

  return (
    <Drawer.Root
      open
      onOpenChange={(_open, details) => {
        // A swipe down past the peek: stay open, settle at the peek.
        details.cancel();
        dismissed.current = true;
        setSnapPoint(PEEK);
      }}
      modal={false}
      disablePointerDismissal
      snapPoints={SNAP_POINTS}
      snapPoint={snapPoint}
      onSnapPointChange={(next) => {
        // After a cancelled dismissal, Base UI restores the snap point the swipe began
        // at; the peek is where it should land. `null` (dismissed) is the peek too.
        setSnapPoint(dismissed.current ? PEEK : (next ?? PEEK));
        dismissed.current = false;
      }}
    >
      <Drawer.Portal>
        <Drawer.Viewport className="pointer-events-none fixed inset-0 flex items-end">
          <Drawer.Popup
            initialFocus={false}
            finalFocus={false}
            className="pointer-events-auto relative flex h-[calc(100dvh-3rem)] min-h-0 w-full touch-none flex-col rounded-t-xl border-t border-foreground bg-background text-foreground shadow-[0_-4px_16px_rgb(0_0_0/0.15)] outline-none [padding-bottom:max(0px,calc(var(--drawer-snap-point-offset)+var(--drawer-swipe-movement-y)))] [transform:translateY(calc(var(--drawer-snap-point-offset)+var(--drawer-swipe-movement-y)))] transition-transform duration-[450ms] ease-[cubic-bezier(0.32,0.72,0,1)]"
          >
            <div className="shrink-0 px-4 pt-2 pb-3 select-none">
              <div
                aria-hidden="true"
                className="mx-auto mb-2 h-1 w-10 rounded-full bg-foreground/40"
              />
              <div className="flex items-center justify-between gap-2">
                <Drawer.Title className="font-bold">{title}</Drawer.Title>
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setSnapPoint(expanded ? PEEK : FULL)}
                  className="h-10 px-2 underline underline-offset-2"
                >
                  {expanded ? "Show the map" : showLabel}
                </button>
              </div>
            </div>
            <Drawer.Content
              key={contentKey}
              className="min-h-0 flex-1 touch-auto overflow-y-auto overscroll-contain px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
            >
              {children}
            </Drawer.Content>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
