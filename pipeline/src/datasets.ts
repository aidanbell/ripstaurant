// The bulk open datasets the snapshot job pulls from Toronto's open data portal.
//
// The raw file keeps every row (for 180 days). `keep` picks the rows stored in
// source_records, the durable history: the ones that can say something about a food
// business. Widening a filter means re-reading recent raw files, or refetching: most of
// these files keep their own history (DineSafe, whose rows age out, is kept whole).

import {
  parseAddressParts,
  parseDinesafeAddress,
  parseStreetAddress,
  toLngLat,
} from "./address";
import type { LngLat, ParsedAddress } from "./address";
import { fromUsDate } from "./records";

export type Row = Record<string, string>;

export type BulkDataset = {
  /** `source` in ingests and source_records. */
  source: string;
  /** CKAN package id and resource name. */
  pkg: string;
  resource: string;
  /** The resource is a ZIP of CSVs (the DineSafe archive: one file per year). */
  zip?: boolean;
  /**
   * Columns holding the row's position in its file, left out of the stored row: they'd
   * make every row look new on the next pull. Default `_id` (the portal's row number).
   */
  positional?: string[];
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

/** Keeps archive inspections from 2020 on: closures from 2022-03 need each place's last inspection before it closed, and inspections were sparse in 2020–21. Older years stay in the City's archive. */
const ARCHIVE_SINCE = "2020-01-01";

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
    near: (row) => toLngLat(row.longitude, row.latitude),
  },
  {
    // The yearly archive, 2001–2023, in the older schema. It carries each establishment's
    // type, which the current feed doesn't; current rows link to it by `oldEstId`.
    source: "dinesafe_archive",
    pkg: "dinesafe",
    resource: "Dinesafe Historical Data",
    zip: true,
    positional: ["Rec #"],
    columns: [
      "Establishment ID",
      "Inspection ID",
      "Establishment Address",
      "Inspection Date",
      "Latitude",
      "Longitude",
    ],
    key: (row) => row["Inspection ID"] ?? "",
    keep: (row) => fromUsDate(row["Inspection Date"] ?? "") >= ARCHIVE_SINCE,
    // "266 EDDYSTONE AVE, Unit-0", "2190 MCNICOLL AVE, -109": unit after a comma.
    address: (row) => parseStreetAddress(row["Establishment Address"] ?? ""),
    near: (row) => toLngLat(row.Longitude, row.Latitude),
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
