// The phone sheet's stops (ClosureSheet), shared with the page so the map's bottom edge
// sits above the peek and a selected closure is centred in the part left showing.

const REM = 16;

/** Down: the handle and title, clear of the home bar. */
export const PEEK_REM = 5;
/** Showing a closure (or part of the list), leaving the map above it usable. */
export const MIDDLE_REM = 22;

/** How much of the map (which ends above the peek) the sheet covers at its middle stop. */
export const MIDDLE_COVERS_PX = (MIDDLE_REM - PEEK_REM) * REM;
