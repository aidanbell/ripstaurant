import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { CityList, LocationDetail, Manifest, locationPath, rowsFromLocation, slugify, sortDate, type ClosureRow } from ".";

const SAMPLE = new URL("../sample/", import.meta.url).pathname;
const read = async (rel: string) => Bun.file(SAMPLE + rel).json();

const manifest = Manifest.parse(await read("manifest.json"));
const city = manifest.cities[0]!;
const list = CityList.parse(await read(city.list));
const locationFiles = await readdir(`${SAMPLE}${city.slug}/locations`);
const details = await Promise.all(locationFiles.map(async (f) => LocationDetail.parse(await read(`${city.slug}/locations/${f}`))));

describe("committed sample", () => {
  test("manifest count matches the list", () => {
    expect(city.count).toBe(list.closures.length);
  });

  test("every row's location has a detail file", () => {
    const ids = new Set(details.map((d) => d.id));
    for (const row of list.closures) expect(ids.has(row.loc)).toBe(true);
  });

  test("list rows are exactly what the detail files derive", () => {
    const derived = details.flatMap((d) => rowsFromLocation(d, list.hoods));
    const byId = (a: ClosureRow, b: ClosureRow) => a.id.localeCompare(b.id);
    expect([...list.closures].sort(byId)).toEqual(derived.sort(byId));
  });

  test("detail files are named by location id", () => {
    for (const d of details) expect(locationFiles).toContain(locationPath(city.slug, d.id).split("/").pop()!);
  });

  test("rows are sorted: undated announcements first, then newest first", () => {
    const keys = list.closures.map((r) => sortDate(r.d) ?? "9999");
    expect(keys).toEqual([...keys].sort().reverse());
  });

  test("covers the tricky cases the frontend must handle", () => {
    const has = (p: (r: ClosureRow) => boolean) => list.closures.some(p);
    expect(has((r) => r.status === "announced" && r.d[1] === null)).toBe(true); // no date yet
    expect(has((r) => r.status === "announced" && r.d[1] !== null)).toBe(true); // future date
    expect(has((r) => r.status === "reopened")).toBe(true);
    expect(has((r) => r.type === "relocated")).toBe(true);
    expect(has((r) => r.type === "format_change")).toBe(true);
    expect(has((r) => r.d[0] === null && r.d[1] !== null)).toBe(true); // "by <date>"
    expect(has((r) => r.d[0] !== null && r.d[0] !== r.d[1])).toBe(true); // window
    expect(has((r) => r.rs.length === 0)).toBe(true);
    expect(has((r) => r.rs.length > 1)).toBe(true);
    expect(new Set(list.closures.map((r) => r.loc)).size).toBeLessThan(list.closures.length); // shared location
  });
});

describe("schema guards", () => {
  const row = list.closures.find((r) => r.status === "closed")!;
  const withRow = (patch: Partial<ClosureRow>) => ({ ...list, closures: [{ ...row, ...patch }] });

  test("rejects a neighbourhood index out of range", () => {
    expect(CityList.safeParse(withRow({ hood: list.hoods.length })).success).toBe(false);
  });

  test("rejects coordinates outside the city", () => {
    expect(CityList.safeParse(withRow({ ll: [-73.5673, 45.5017] })).success).toBe(false);
  });

  test("rejects swapped lat/lng", () => {
    expect(CityList.safeParse(withRow({ ll: [row.ll[1], row.ll[0]] })).success).toBe(false);
  });

  test("rejects a date range that ends before it starts", () => {
    expect(CityList.safeParse(withRow({ d: ["2025-05-01", "2025-04-01"] })).success).toBe(false);
  });

  test("rejects a closed event with no dates", () => {
    expect(CityList.safeParse(withRow({ d: [null, null] })).success).toBe(false);
  });

  test("rejects events before the coverage window", () => {
    expect(CityList.safeParse(withRow({ d: ["2021-06-01", "2021-06-01"] })).success).toBe(false);
  });

  test("rejects non-food businesses and retracted events", () => {
    expect(CityList.safeParse(withRow({ bt: "non_food" as never })).success).toBe(false);
    expect(CityList.safeParse(withRow({ status: "retracted" as never })).success).toBe(false);
  });

  test("rejects duplicate event ids", () => {
    expect(CityList.safeParse({ ...list, closures: [row, row] }).success).toBe(false);
  });

  test("rejects a detail source reference that doesn't exist", () => {
    const d = details.find((x) => x.occupants.some((o) => o.event))!;
    expect(LocationDetail.safeParse({ ...d, sources: [] }).success).toBe(false);
  });
});

test("slugify makes readable ids", () => {
  expect(slugify("Daddy's Chicken")).toBe("daddys-chicken");
  expect(slugify("Bar St. Lo")).toBe("bar-st-lo");
  expect(slugify("Café Mimi’s")).toBe("cafe-mimis");
});
