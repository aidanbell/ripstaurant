// The bulk open datasets the snapshot job pulls from Toronto's open data portal.
//
// The raw file always keeps every row. `keep` picks the rows stored in source_records:
// the ones that can say something about a food business. Widening a filter later means
// re-reading archived raw files, not refetching.

export type Row = Record<string, string>;

export type BulkDataset = {
  /** `source` in ingests and source_records. */
  source: string;
  /** CKAN package id and resource name. */
  pkg: string;
  resource: string;
  /** Columns `key` and `keep` read. The job fails if a file lacks any, e.g. after a schema change. */
  columns: string[];
  /** The record's id within the dataset. Not always unique (permit revisions repeat). */
  key: (row: Row) => string;
  keep: (row: Row) => boolean;
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

const PERMIT_COLUMNS = [
  "PERMIT_NUM",
  "REVISION_NUM",
  "PERMIT_TYPE",
  "WORK",
  "CURRENT_USE",
  "PROPOSED_USE",
  "DESCRIPTION",
];

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

export const TORONTO_DATASETS: BulkDataset[] = [
  {
    source: "dinesafe",
    pkg: "dinesafe",
    resource: "Dinesafe.csv",
    columns: ["unique_id"],
    key: (row) => row.unique_id ?? "",
    keep: () => true,
  },
  {
    source: "business_licences",
    pkg: "municipal-licensing-and-standards-business-licences-and-permits",
    resource: "Business licences data.csv",
    columns: ["Licence No.", "Category"],
    key: (row) => row["Licence No."] ?? "",
    keep: (row) => FOOD_LICENCES.has(row.Category ?? ""),
  },
  {
    source: "building_permits_active",
    pkg: "building-permits-active-permits",
    resource: "building-permits-active-permits.csv",
    columns: PERMIT_COLUMNS,
    key: permitKey,
    keep: isRelevantPermit,
  },
  {
    source: "building_permits_cleared",
    pkg: "building-permits-cleared-permits",
    resource: "Cleared Building Permits since 2017.csv",
    columns: PERMIT_COLUMNS,
    key: permitKey,
    keep: isRelevantPermit,
  },
  {
    // Redevelopment is matched by address, so every application is kept.
    source: "development_applications",
    pkg: "development-applications",
    resource: "Development Applications.csv",
    columns: ["APPLICATION#"],
    key: (row) => row["APPLICATION#"] ?? "",
    keep: () => true,
  },
];
