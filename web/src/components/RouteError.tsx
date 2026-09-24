import { Link, isRouteErrorResponse, useRouteError } from "react-router";

/** Shown for a bad URL, a missing record, or data that failed to load. */
export function RouteError() {
  const error = useRouteError();
  let message = "Something went wrong loading this page.";
  if (isRouteErrorResponse(error)) message = String(error.data);
  else if (error instanceof Error) message = error.message;
  return (
    <main>
      <h1>Not available</h1>
      <p role="alert">{message}</p>
      <p>
        <Link to="/">Back to the map</Link>
      </p>
    </main>
  );
}
