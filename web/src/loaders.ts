// Route loaders: they fetch through the data module before a route renders, so pages
// get their data with `useLoaderData<typeof loader>()`. A missing file is a 404.

import { data } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { DataFileError, getLocation, loadCity } from "./data";

export const CITY = "toronto";

export function cityLoader() {
  return loadCity(CITY);
}

export async function locationLoader({ params }: LoaderFunctionArgs) {
  try {
    return await getLocation(CITY, params.id ?? "");
  } catch (error) {
    if (error instanceof DataFileError && error.status === 404)
      throw data("No closure recorded at this address.", { status: 404 });
    throw error;
  }
}
