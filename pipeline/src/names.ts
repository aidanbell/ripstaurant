// Business name normalization, for recognizing the same establishment across records
// ("PIZZA NOVA #123", "Pizza Nova Inc.") and for grouping chains.

const CORPORATE = new Set([
  "INC",
  "INCORPORATED",
  "LTD",
  "LIMITED",
  "CORP",
  "CORPORATION",
  "CO",
  "LLC",
  "ULC",
  "LLP",
]);

/** "The Pizza Nova #123 Inc." → "PIZZA NOVA". Empty when nothing distinctive is left. */
export function nameKey(name: string): string {
  const tokens = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/['’`.]/g, "")
    // Store numbers: "#123", "# 45".
    .replace(/#\s*\d+/g, " ")
    .split(/[^A-Z0-9]+/)
    .filter((t) => t && !CORPORATE.has(t));
  if (tokens[0] === "THE") tokens.shift();
  return tokens.join(" ");
}

/**
 * 1 for the same name, 0.9 when one name's words are all in the other ("PIZZA NOVA" and
 * "PIZZA NOVA TAKE OUT"), otherwise the share of words in common (Jaccard).
 */
export function nameSimilarity(a: string, b: string): number {
  const x = nameKey(a);
  const y = nameKey(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const left = new Set(x.split(" "));
  const right = new Set(y.split(" "));
  let common = 0;
  for (const token of left) if (right.has(token)) common++;
  if (common === Math.min(left.size, right.size)) return 0.9;
  return common / (left.size + right.size - common);
}

/** Words too common in food business names to identify one on their own. */
const GENERIC = new Set(
  (
    "AND OF THE ON AT BY LA LE EL DE DU DA " +
    "RESTAURANT RESTAURANTS CAFE CAFFE COFFEE TEA BAR BARS PUB GRILL KITCHEN HOUSE " +
    "FOOD FOODS EXPRESS TAKE OUT TAKEOUT BAKERY BAKE SHOP STORE MARKET MART DELI " +
    "PIZZA PIZZERIA SUSHI PHO NOODLE NOODLES RAMEN BBQ BURGER BURGERS CHICKEN WINGS " +
    "THAI CHINESE INDIAN ITALIAN KOREAN JAPANESE VIETNAMESE GREEK MEXICAN CARIBBEAN " +
    "HALAL VEGAN GOURMET FRESH GOLDEN ROYAL NEW TORONTO CANADA ONTARIO " +
    // Cuisine and format words: a later business in the same unit often shares one.
    "CATERING DONER KEBAB SHAWARMA FALAFEL LOUNGE FUSION CUISINE BISTRO EATERY DINER " +
    "TAVERN CANTEEN SNACK SNACKS SWEETS DESSERT DESSERTS CAKE CAKES JUICE BUBBLE BOBA " +
    "POKE TACO TACOS BURRITO BURRITOS DUMPLING DUMPLINGS HOT POT SPICY TASTY SEAFOOD " +
    "FISH MEAT MEATS BUTCHER GROCERY CONVENIENCE VARIETY SUPERMARKET FARM WINE BEER " +
    "AFRICAN ETHIOPIAN PERSIAN LEBANESE TURKISH MIDDLE EASTERN BRAZIL BRAZILIAN " +
    "PLACE SPOT CORNER STATION PLAZA CENTRE CENTER CITY STREET"
  ).split(" "),
);

/** The names share a word that isn't a generic food word ("KEZY FOODS" and "KEZY DONER"). */
export function sharesDistinctiveWord(a: string, b: string): boolean {
  const right = new Set(nameKey(b).split(" "));
  return nameKey(a)
    .split(" ")
    .some(
      (w) =>
        w.length > 2 && !GENERIC.has(w) && !/^\d+$/.test(w) && right.has(w),
    );
}

/** "STARBUCKS COFFEE" → "STARBUCKS": a chain's key, without trailing generic words. */
export function chainKey(name: string): string {
  const words = nameKey(name).split(" ").filter(Boolean);
  while (words.length > 1 && GENERIC.has(words.at(-1) ?? "")) words.pop();
  // A numbered company ("505707 ONTARIO") names an owner, not a brand.
  if (/^\d+$/.test(words[0] ?? "") && words.length <= 2) return "";
  return words.join(" ");
}

const NOT_COVERED = [
  // Institutions, which DineSafe inspects but which need no business licence.
  /\b(SCHOOL|SNP|SNACK PROGRAM|STUDENT NUTRITION|DAY ?CARE|CHILD ?CARE|NURSERY|MONTESSORI|CHURCH|PARISH|MOSQUE|TEMPLE|SYNAGOGUE|HOSPITAL|HEALTH ?CARE|NURSING|RETIREMENT|LONG TERM CARE|UNIVERSITY|COLLEGE|YMCA|YWCA|COMMUNITY CENTRE|SHELTER|HOSTEL|MISSION|CAMP)\b/,
  // Event booths: "DINNER IN THE SKY - CNE 2025", "RICK'S GOOD EATS - DWV 2025".
  /\b(CNE|DWV|EXPO|FESTIVAL|FEST|FAIR)\s*\d{4}\b/,
];

/** For establishments with no type from any record: does the name say it's not a business the site covers? */
export function looksNotCovered(name: string): boolean {
  const key = nameKey(name);
  return NOT_COVERED.some((re) => re.test(key));
}
