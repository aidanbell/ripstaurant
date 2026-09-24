// Toronto address normalization. Each dataset writes addresses its own way:
//
//   DineSafe          "463 Dundas St W None M5T 1G8"   address, unit slot, postal slot
//                     "2555 Victoria Park Ave Unit-2 M1T 1A3"
//   Licences          "626 KING ST W, #100"            unit after a comma
//   Permits, dev apps STREET_NUM, STREET_NAME, STREET_TYPE, STREET_DIRECTION
//   Address Points    LO_NUM, LO_NUM_SUF, LINEAR_NAME_FULL ("429", "A", "Yonge St")
//
// All of them parse into the same ParsedAddress and meet at its `key`. Both sides of a
// match go through the same normalization, so an ambiguous word (is "Park" a street
// type or part of the name?) is resolved the same way on each side.

export type ParsedAddress = {
  /** Number + street, normalized: "429A YONGE ST", "650 1/2 QUEEN ST W". Matches address_points.match_key. */
  key: string;
  /** Normalized unit ("Unit-108A", "#108A" → "108A"); null = none. */
  unit: string | null;
};

/** Street types, spelled out or abbreviated, to the abbreviation Address Points uses. */
const TYPES: Record<string, string> = {
  AV: "AVE",
  AVE: "AVE",
  AVENUE: "AVE",
  BLVD: "BLVD",
  BOULEVARD: "BLVD",
  CIR: "CRCL",
  CIRCLE: "CRCL",
  CRCL: "CRCL",
  CIRCUIT: "CRCT",
  CRCT: "CRCT",
  CRES: "CRES",
  CRESCENT: "CRES",
  COURT: "CRT",
  CRT: "CRT",
  CT: "CRT",
  DR: "DR",
  DRIVE: "DR",
  GARDENS: "GDNS",
  GDNS: "GDNS",
  GREEN: "GRN",
  GRN: "GRN",
  GROVE: "GRV",
  GRV: "GRV",
  GATE: "GT",
  GT: "GT",
  HEIGHTS: "HTS",
  HTS: "HTS",
  LANE: "LANE",
  LN: "LANE",
  LAWN: "LWN",
  LWN: "LWN",
  PARK: "PK",
  PK: "PK",
  PARKWAY: "PKWY",
  PKWY: "PKWY",
  PL: "PL",
  PLACE: "PL",
  PATHWAY: "PTWY",
  PTWY: "PTWY",
  RD: "RD",
  ROAD: "RD",
  RDWY: "RDWY",
  ROADWAY: "RDWY",
  SQ: "SQ",
  SQUARE: "SQ",
  ST: "ST",
  STREET: "ST",
  TER: "TER",
  TERR: "TER",
  TERRACE: "TER",
  TRAIL: "TRL",
  TRL: "TRL",
  WDS: "WDS",
  WOODS: "WDS",
};

const DIRECTIONS: Record<string, string> = {
  E: "E",
  EAST: "E",
  N: "N",
  NORTH: "N",
  S: "S",
  SOUTH: "S",
  W: "W",
  WEST: "W",
};

/** "O'Connor Dr." → "OCONNOR DR"; "Queen Street West" → "QUEEN ST W". Only the trailing type and direction are rewritten, so "St Clair" keeps its "St". */
function streetKey(street: string): string {
  const tokens = street
    .toUpperCase()
    .replace(/['’.]/g, "")
    .replace(/[^A-Z0-9/ ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  let direction = "";
  const last = tokens.at(-1);
  if (tokens.length > 1 && last && last in DIRECTIONS) {
    direction = DIRECTIONS[last] ?? "";
    tokens.pop();
  }
  const type = tokens.at(-1);
  if (tokens.length > 1 && type && type in TYPES)
    tokens[tokens.length - 1] = TYPES[type] ?? type;
  if (direction) tokens.push(direction);
  return tokens.join(" ");
}

function normalizeUnit(raw: string | undefined): string | null {
  const unit = (raw ?? "")
    .toUpperCase()
    .replace(/^(UNIT|STE|SUITE|APT)\b/, "")
    .replace(/^[\s#-]+|[\s-]+$/g, "")
    .replace(/\s+/g, " ");
  if (!unit || unit === "NONE" || unit === "0") return null;
  return unit;
}

/** Number, optional letter or 1/2 suffix (also written ".5"), optional range end (ignored), then the street. */
const NUMBERED =
  /^(\d+)(?:\s*-\s*\d+)?(?:([A-Z])\b|\s+(1\/2)\b|(\.5)\b)?\s+(.+)$/i;

/** "429A Yonge St", "11-19 Industrial St", "40 HANNA AVE, Ste-203". Null without a house number. */
export function parseStreetAddress(
  text: string,
  unit?: string,
): ParsedAddress | null {
  const [address = "", inlineUnit] = text.trim().split(/\s*,\s*/, 2);
  const match = NUMBERED.exec(address);
  if (!match) return null;
  const [, number = "", letter, half, decimalHalf, street = ""] = match;
  if (Number(number) === 0) return null;
  const suffix = half || decimalHalf ? " 1/2" : (letter?.toUpperCase() ?? "");
  const key = `${Number(number)}${suffix} ${streetKey(street)}`;
  return { key, unit: normalizeUnit(unit ?? inlineUnit) };
}

const DINESAFE = /^(.+?)\s+(\S+)\s+([A-Z]\d[A-Z]\s?\d[A-Z]\d|None)$/i;

/** "2555 Victoria Park Ave Unit-2 M1T 1A3": address, then a unit slot and a postal slot, either of which can be "None". */
export function parseDinesafeAddress(text: string): ParsedAddress | null {
  const match = DINESAFE.exec(text.trim());
  if (!match) return parseStreetAddress(text);
  const [, address = "", unit = ""] = match;
  return unit.toUpperCase() === "NONE"
    ? parseStreetAddress(address)
    : parseStreetAddress(address, unit);
}

/**
 * Separate number and street parts (permits, development applications). The number part
 * can hold a spaced suffix or a range: "2107 A" → 2107A, "4916 A 4944 A" → 4916A.
 */
export function parseAddressParts(
  number: string | undefined,
  ...street: (string | undefined)[]
): ParsedAddress | null {
  const num = (number ?? "").trim().replace(/^(\d+)\s+([A-Z])\b.*$/i, "$1$2");
  return parseStreetAddress(
    [num, ...street]
      .map((p) => p?.trim() ?? "")
      .filter((p) => p && p.toUpperCase() !== "NONE")
      .join(" "),
  );
}

/** An Address Points row's match key: LO_NUM, LO_NUM_SUF ("A", "1/2", "None") and LINEAR_NAME_FULL. */
export function addressPointKey(
  number: string,
  suffix: string,
  street: string,
): string | null {
  let suf = suffix;
  if (suffix === "None") suf = "";
  if (suffix === "1/2") suf = " 1/2";
  return parseStreetAddress(`${number}${suf} ${street}`)?.key ?? null;
}

/** How a record's address was matched, strongest first. */
export type MatchMethod =
  | "id" // the dataset's own Address Point id
  | "exact"
  | "unit_trimmed" // trailing text after a known street moved to the unit ("FRONT ST W CN")
  | "suffix_dropped" // "1718A" not a point; "1718" is
  | "nearby"; // number not a point; the closest same-side number within NEARBY_RANGE is

export type AddressMatch =
  | { pointId: string; method: MatchMethod; unit: string | null }
  /**
   * The address exists in more than one place (a street name shared by two former
   * municipalities: 97 Simpson Ave) and the record has no coordinates to choose by.
   * Better unresolved than wrong; a linked record can settle it later.
   */
  | {
      pointId: null;
      method: "ambiguous";
      candidates: string[];
      unit: string | null;
    };

/** [longitude, latitude] */
export type LngLat = [number, number];

/** How far along a street to look for a missing number's neighbour: 219 → 217, 221, 215… */
const NEARBY_RANGE = 10;

/** Points for one address further apart than this are different places, not a building's entrances. */
const SAME_PLACE_METRES = 500;

/** Splits a match key: "429A YONGE ST" → 429, "A", "YONGE ST". */
const KEY = /^(\d+)([A-Z]| 1\/2)? (.+)$/;

type IndexedPoint = {
  id: string;
  source_key: string;
  match_key: string;
  lng: number;
  lat: number;
};

/** Approximate ground distance; fine at city scale. */
function metres([lng1, lat1]: LngLat, [lng2, lat2]: LngLat): number {
  const x = (lng2 - lng1) * 111_320 * Math.cos((lat1 * Math.PI) / 180);
  const y = (lat2 - lat1) * 110_540;
  return Math.hypot(x, y);
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/**
 * Matches parsed addresses to address points, in memory (Toronto has ~525k). Pass points
 * ordered by id, so ties always resolve to the same point.
 */
export class AddressMatcher {
  private readonly bySourceKey = new Map<string, string>();
  private readonly byKey = new Map<string, string[]>();
  /** Street → plain house number → point ids. */
  private readonly byStreet = new Map<string, Map<number, string[]>>();
  private readonly coords = new Map<string, LngLat>();

  constructor(points: Iterable<IndexedPoint>) {
    for (const point of points) {
      this.bySourceKey.set(point.source_key, point.id);
      this.coords.set(point.id, [point.lng, point.lat]);
      push(this.byKey, point.match_key, point.id);
      const [, number, suffix, street] = KEY.exec(point.match_key) ?? [];
      if (!number || !street) continue;
      const numbers = this.byStreet.get(street) ?? new Map<number, string[]>();
      this.byStreet.set(street, numbers);
      if (!suffix) push(numbers, Number(number), point.id);
    }
  }

  /**
   * @param addressPointId the dataset's own Address Point id, if it has one
   * @param near the record's own coordinates, if it has them; used to choose between candidates
   */
  match(
    parsed: ParsedAddress | null,
    addressPointId?: string | null,
    near?: LngLat | null,
  ): AddressMatch | null {
    const unit = parsed?.unit ?? null;
    const byId = addressPointId && this.bySourceKey.get(addressPointId);
    if (byId) return { pointId: byId, method: "id", unit };
    if (!parsed) return null;
    const exact = this.byKey.get(parsed.key);
    if (exact) return this.choose(exact, "exact", unit, near);

    const [, number = "", suffix = "", fullStreet = ""] =
      KEY.exec(parsed.key) ?? [];
    const found = this.knownStreet(fullStreet);
    if (!found) return null;
    const { street, rest } = found;
    const streetUnit = rest ? (unit ?? normalizeUnit(rest)) : unit;

    const same = this.byKey.get(`${number}${suffix} ${street}`);
    if (same)
      return this.choose(
        same,
        rest ? "unit_trimmed" : "exact",
        streetUnit,
        near,
      );
    const numbers = this.byStreet.get(street);
    const plain = suffix ? numbers?.get(Number(number)) : undefined;
    if (plain) return this.choose(plain, "suffix_dropped", streetUnit, near);
    const nearby = numbers && nearest(numbers, Number(number));
    if (nearby) return this.choose(nearby, "nearby", streetUnit, near);
    return null;
  }

  /** One candidate, the one nearest the record's coordinates, or ambiguous if they're far apart. */
  private choose(
    ids: string[],
    method: MatchMethod,
    unit: string | null,
    near: LngLat | null | undefined,
  ): AddressMatch {
    const [first] = ids;
    if (!first) throw new Error("empty candidate list");
    if (ids.length === 1) return { pointId: first, method, unit };
    const at = (id: string) => this.coords.get(id) ?? [0, 0];
    if (near) {
      let best = first;
      for (const id of ids)
        if (metres(at(id), near) < metres(at(best), near)) best = id;
      return { pointId: best, method, unit };
    }
    const spread = Math.max(...ids.map((id) => metres(at(first), at(id))));
    if (spread <= SAME_PLACE_METRES) return { pointId: first, method, unit };
    return { pointId: null, method: "ambiguous", candidates: ids, unit };
  }

  /** The street itself if known, else its longest known prefix; the rest is unit text. */
  private knownStreet(street: string): { street: string; rest: string } | null {
    const tokens = street.split(" ");
    for (let n = tokens.length; n >= 1; n--) {
      const prefix = tokens.slice(0, n).join(" ");
      if (this.byStreet.has(prefix))
        return { street: prefix, rest: tokens.slice(n).join(" ") };
    }
    return null;
  }
}

/** Points at the closest number(s) on the same side of the street (same parity) within NEARBY_RANGE. */
function nearest(
  numbers: Map<number, string[]>,
  number: number,
): string[] | null {
  for (let d = 2; d <= NEARBY_RANGE; d += 2) {
    const ids = [
      ...(numbers.get(number - d) ?? []),
      ...(numbers.get(number + d) ?? []),
    ];
    if (ids.length) return ids;
  }
  return null;
}
