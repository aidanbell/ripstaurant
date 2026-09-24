// The bulk open datasets the snapshot job pulls from Toronto's open data portal.
//
// The raw file always keeps every row. `keep` picks the rows stored in source_records:
// the ones that can say something about a food business. Widening a filter later means
// re-reading archived raw files, not refetching.

import {
  parseAddressParts,
  parseDinesafeAddress,
  parseStreetAddress,
} from "./address";
import type { LngLat, ParsedAddress } from "./address";

export type Row = Record<string, string>;

export type BulkDataset = {
  /** `source` in ingests and source_records. */
  source: string;
  /** CKAN package id and resource name. */
  pkg: string;
  resource: string;
  /** Columns the functions below read. The job fails if a file lacks any, e.g. after a schema change. */
  columns: string[];
  /** The record's id within the dataset. Not always unique (permit revisions repeat). */
  key: (row: Row) => string;
  keep: (row: Row) => boolean;
  /** The record's address, normalized for matching to address_points (see address.ts). */
  address: (row: Row) => ParsedAddress | null;
  /** The City's own Address Point id, when the dataset carries one; tried before `address`. */
  addressPointId?: (row: Row) => string | null;
  /** The record's own coordinates, when it has them; used to choose between candidate points. */
  near?: (row: Row) => LngLat | null;
};

const FOOD_LICENCES = new Set([
  "EATING OR DRINKING ESTABLISHMENT",
  "EXPANDED EATING/DRINKING ESTABLISHMENT",
  "TAKE-OUT OR RETAIL FOOD ESTABLISHMENT",
  "ENTERTAINMENT ESTABLISHMENT/NIGHTCLUB",
  // Patio licences: evidence a restaurant was operating.
  "SIDEWALK CAFE",
  "CURB LANE CAFE",
]);

const FOOD_USE =
  /restaurant|eating|take[- ]?out|caf[eé]|bakery|\bbar\b|\bpub\b|brew|food|night ?club|coffee/i;

const STREET_PARTS = [
  "STREET_NUM",
  "STREET_NAME",
  "STREET_TYPE",
  "STREET_DIRECTION",
];

const PERMIT_COLUMNS = [
  "PERMIT_NUM",
  "REVISION_NUM",
  "PERMIT_TYPE",
  "WORK",
  "CURRENT_USE",
  "PROPOSED_USE",
  "DESCRIPTION",
  "GEO_ID",
  ...STREET_PARTS,
];

function streetParts(row: Row): ParsedAddress | null {
  return parseAddressParts(
    row.STREET_NUM,
    row.STREET_NAME,
    row.STREET_TYPE,
    row.STREET_DIRECTION,
  );
}

/** Food-related use or description (conversions to and from restaurants), or any demolition. */
function isRelevantPermit(row: Row): boolean {
  const text = `${row.CURRENT_USE ?? ""} ${row.PROPOSED_USE ?? ""} ${row.DESCRIPTION ?? ""}`;
  const demolition =
    (row.PERMIT_TYPE ?? "").startsWith("Demolition") ||
    (row.WORK ?? "").includes("Demolition");
  return demolition || FOOD_USE.test(text);
}

function permitKey(row: Row): string {
  return `${row.PERMIT_NUM ?? ""}~${row.REVISION_NUM ?? ""}`;
}

/** Permits carry the Address Point id as GEO_ID (89% of rows). */
function permitAddressPointId(row: Row): string | null {
  return row.GEO_ID?.trim() || null;
}

export const TORONTO_DATASETS: BulkDataset[] = [
  {
    source: "dinesafe",
    pkg: "dinesafe",
    resource: "Dinesafe.csv",
    columns: ["unique_id", "address", "latitude", "longitude"],
    key: (row) => row.unique_id ?? "",
    keep: () => true,
    address: (row) => parseDinesafeAddress(row.address ?? ""),
    near: (row) => {
      const lng = Number(row.longitude);
      const lat = Number(row.latitude);
      return lng && lat ? [lng, lat] : null;
    },
  },
  {
    source: "business_licences",
    pkg: "municipal-licensing-and-standards-business-licences-and-permits",
    resource: "Business licences data.csv",
    columns: ["Licence No.", "Category", "Licence Address Line 1"],
    key: (row) => row["Licence No."] ?? "",
    keep: (row) => FOOD_LICENCES.has(row.Category ?? ""),
    // "626 KING ST W, #100"; lines 2 and 3 are city and postal code.
    address: (row) => parseStreetAddress(row["Licence Address Line 1"] ?? ""),
  },
  {
    source: "building_permits_active",
    pkg: "building-permits-active-permits",
    resource: "building-permits-active-permits.csv",
    columns: PERMIT_COLUMNS,
    key: permitKey,
    keep: isRelevantPermit,
    address: streetParts,
    addressPointId: permitAddressPointId,
  },
  {
    source: "building_permits_cleared",
    pkg: "building-permits-cleared-permits",
    resource: "Cleared Building Permits since 2017.csv",
    columns: PERMIT_COLUMNS,
    key: permitKey,
    keep: isRelevantPermit,
    address: streetParts,
    addressPointId: permitAddressPointId,
  },
  {
    // Redevelopment is matched by address, so every application is kept.
    source: "development_applications",
    pkg: "development-applications",
    resource: "Development Applications.csv",
    columns: ["APPLICATION#", ...STREET_PARTS],
    key: (row) => row["APPLICATION#"] ?? "",
    keep: () => true,
    address: streetParts,
  },
];
