// Typed records from source_records rows. Raw rows are untyped strings in each dataset's
// own schema; these parsers validate them and map every schema onto one shape:
//
//   Inspection  DineSafe's current feed (camelCase columns, from 2023-11) and its
//               yearly archive (2001–2023: "Establishment ID", MM/DD/YYYY dates in 2023)
//   Licence     Business licences, whose type vocabulary changed with the 2020 bylaw:
//               VICTUALLING / REFRESHMENTS / FOODSTUFFS before, EATING/DRINKING and
//               TAKE-OUT OR RETAIL FOOD after
//
// A value outside what each parser expects (a new status, an unreadable date) throws,
// so schema changes surface in `bun run report` instead of becoming bad data.

import type { BusinessType } from "@ripstaurant/contract";
import { z } from "zod";
import { toLngLat } from "./address";
import type { LngLat } from "./address";
import type { Row } from "./datasets";

export type InspectionStatus =
  | "pass"
  | "conditional_pass"
  // A health closure order: a documented `health_enforcement` reason. Current feed only.
  | "closed"
  | "not_operating";

/** One row per infraction (or one row for a clean inspection), so an inspection spans rows. */
export type Inspection = {
  establishmentId: string;
  /** Current-feed rows: the establishment's id in the archive (`oldEstId`), which carries its type. */
  archiveId: string | null;
  name: string;
  /** Archive rows only, e.g. "Restaurant"; see dinesafeBusinessType. */
  establishmentType: string | null;
  date: string;
  status: InspectionStatus;
  near: LngLat | null;
};

export type Licence = {
  number: string;
  category: string;
  operatingName: string | null;
  /** Client Name. Can be a person; internal only, never exported. */
  owner: string;
  issued: string | null;
  cancelled: string | null;
  /** From category, endorsements and seating; null = no signal (patio licences). */
  businessType: BusinessType | null;
  /** Licensed with the CHAIN condition. */
  chain: boolean;
};

/** "12/29/2023" → "2023-12-29" (MM/DD/YYYY: the 2023 archive's day part reaches 31); other values unchanged. */
export function fromUsDate(value: string): string {
  const us = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  return us ? `${us[3]}-${us[1]}-${us[2]}` : value;
}

/** A real YYYY-MM-DD date, from that or MM/DD/YYYY. */
function isoDate(value: string): string {
  const iso = fromUsDate(value);
  const date = new Date(`${iso}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(iso) ||
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== iso
  )
    throw new Error(`unreadable date "${value}"`);
  return iso;
}

const RequiredDate = z.string().transform(isoDate);
const OptionalDate = z
  .string()
  .transform((v) => (v.trim() === "" ? null : isoDate(v)));
/** Blank or the literal "None" (DineSafe writes both) → null. */
const OptionalText = z
  .string()
  .transform((v) => (v.trim() === "" || v === "None" ? null : v.trim()));
const Text = z.string().trim().min(1);

const STATUSES: Record<string, InspectionStatus> = {
  Pass: "pass",
  "Conditional Pass": "conditional_pass",
  Closed: "closed",
  "Temporarily Not Operating": "not_operating",
};
const Status = z.string().transform((v, ctx) => {
  const status = STATUSES[v];
  if (!status) {
    ctx.addIssue({ code: "custom", message: `unknown status "${v}"` });
    return z.NEVER;
  }
  return status;
});

const CurrentInspection = z.object({
  estId: Text,
  oldEstId: OptionalText,
  estName: Text,
  inspectionDate: RequiredDate,
  inspectionStatus: Status,
  latitude: z.string(),
  longitude: z.string(),
});

export function inspectionFromCurrent(row: Row): Inspection {
  const r = CurrentInspection.parse(row);
  return {
    establishmentId: r.estId,
    archiveId: r.oldEstId,
    name: r.estName,
    establishmentType: null,
    date: r.inspectionDate,
    status: r.inspectionStatus,
    near: toLngLat(r.longitude, r.latitude),
  };
}

const ArchiveInspection = z.object({
  "Establishment ID": Text,
  "Establishment Name": Text,
  "Establishment Type": Text,
  "Inspection Date": RequiredDate,
  "Establishment Status": Status,
  Latitude: z.string(),
  Longitude: z.string(),
});

export function inspectionFromArchive(row: Row): Inspection {
  const r = ArchiveInspection.parse(row);
  return {
    establishmentId: r["Establishment ID"],
    archiveId: null,
    name: r["Establishment Name"],
    establishmentType: r["Establishment Type"],
    date: r["Inspection Date"],
    status: r["Establishment Status"],
    near: toLngLat(r.Longitude, r.Latitude),
  };
}

/**
 * DineSafe establishment types. null = inspected, but not a business the site covers:
 * institutions (schools, care homes, hospitals), wholesale and production (plants,
 * commissaries, caterers), and anything without a fixed storefront (carts, trucks, boats).
 * A type missing here is new; `bun run report` lists it.
 */
const DINESAFE_TYPES: Record<string, BusinessType | null> = {
  Restaurant: "restaurant",
  "Food Court Vendor": "restaurant",
  "Cafeteria - Public Access": "restaurant",
  "Food Take Out": "take_out",
  "Refreshment Stand (Stationary)": "take_out",
  "Ice Cream / Yogurt Vendors": "take_out",
  "Cocktail Bar / Beverage Room": "bar",
  Bakery: "bakery",
  "Bake Shop": "bakery",
  "Food Store (Convenience/Variety)": "food_retail",
  Supermarket: "food_retail",
  "Butcher Shop": "food_retail",
  "Fish Shop": "food_retail",
  "Brew Your Own Beer / Wine": "brewery",
  "Flea Market": "market",
  "Farmers` Market Vendor": "market",
  "Banquet Facility": null,
  "Church Banquet Facility": null,
  "Private Club": null,
  "Cafeteria - Private Access": null,
  "Child Care - Catered": null,
  "Child Care - Food Preparation": null,
  "Nursing Home / Home for the Aged": null,
  "Retirement Homes(Licensed)": null,
  "Retirement Homes(Un-licensed)": null,
  "Rest Home": null,
  "Boarding / Lodging Home - Kitchen": null,
  "Bed & Breakfast": null,
  "Hospitals & Health Facilities": null,
  "Student Nutrition Site": null,
  "Elementary School Food Services": null,
  "Secondary School Food Services": null,
  "College / University Food Services": null,
  "Other Educational Facility Food Services": null,
  "Institutional Food Services": null,
  "Community Kitchen (Meal Program)": null,
  "Food Bank": null,
  "Food Caterer": null,
  "Serving Kitchen": null,
  Commissary: null,
  "Centralized Kitchen": null,
  "Food Depot": null,
  "Food Vending Facility": null,
  "Food Processing Plant": null,
  "Meat Processing Plant": null,
  "Milk Pasteurization Plant": null,
  "Milk Products Plant": null,
  "Cheese Plant": null,
  "Ice Cream Plant": null,
  "Ice Manufacturing Plant": null,
  "Bottling Plant": null,
  "Locker Plant": null,
  "Mobile Food Preparation Premises": null,
  "Catering Vehicle": null,
  "Hot Dog Cart": null,
  "Food Cart": null,
  "Chartered Cruise Boats": null,
  "Fairs / Festivals / Special Occasions": null,
};

/** A BusinessType, null for types the site doesn't cover, or undefined for a type not seen before. */
export function dinesafeBusinessType(
  type: string,
): BusinessType | null | undefined {
  return type in DINESAFE_TYPES ? (DINESAFE_TYPES[type] ?? null) : undefined;
}

/** "REFRESHMENTS;BAKE SHOP;" → ["REFRESHMENTS", "BAKE SHOP"] */
function list(value: string | undefined): string[] {
  return (value ?? "")
    .split(";")
    .map((v) => v.trim())
    .filter(Boolean);
}

const RETAIL_ENDORSEMENTS = [
  "FOODSTUFFS",
  "xFRESH MEAT DEALER",
  "xFRESH FISH",
  "CIGARS, CIGARETTES & TOBACCO",
  "VAPOUR PRODUCTS (UNREGISTERED)",
];

/** Old and new vocabularies both land here; seating separates restaurants from take-out. */
function licenceBusinessType(
  category: string,
  endorsements: string[],
  conditions: string[],
): BusinessType | null {
  switch (category) {
    case "ENTERTAINMENT ESTABLISHMENT/NIGHTCLUB":
      return "bar";
    case "EATING OR DRINKING ESTABLISHMENT":
    case "EXPANDED EATING/DRINKING ESTABLISHMENT":
      return conditions.includes("NO SEATING ACCOMMODATION")
        ? "take_out"
        : "restaurant";
    case "TAKE-OUT OR RETAIL FOOD ESTABLISHMENT":
      if (endorsements.includes("BAKE SHOP")) return "bakery";
      // Groceries, butchers, and convenience stores (tobacco, vapes) sell but don't serve.
      if (endorsements.some((e) => RETAIL_ENDORSEMENTS.includes(e)))
        return "food_retail";
      return "take_out";
    default:
      return null;
  }
}

const LicenceRow = z.object({
  "Licence No.": Text,
  Category: Text,
  "Operating Name": OptionalText,
  "Client Name": z.string().trim(),
  Issued: OptionalDate,
  "Cancel Date": OptionalDate,
  Endorsements: z.string(),
  Conditions: z.string(),
});

export function licenceFromRow(row: Row): Licence {
  const r = LicenceRow.parse(row);
  const conditions = list(r.Conditions);
  return {
    number: r["Licence No."],
    category: r.Category,
    operatingName: r["Operating Name"],
    owner: r["Client Name"],
    issued: r.Issued,
    cancelled: r["Cancel Date"],
    businessType: licenceBusinessType(
      r.Category,
      list(r.Endorsements),
      conditions,
    ),
    chain: conditions.includes("CHAIN"),
  };
}
