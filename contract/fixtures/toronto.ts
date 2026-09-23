// Hand-curated Toronto sample, built from Phase 0 research (docs/research/phase-0-findings.md):
// DineSafe and business-licence records pulled 2026-09-23, coordinates from DineSafe and
// City Address Points, neighbourhoods by point-in-polygon, and stated reasons from blogTO
// articles (paraphrased). It's a realistic slice for building the frontend, not the real export.
//
// Sources are referenced by key here; the sample builder turns them into indices.

import type {
  BusinessType,
  Claim,
  EventType,
  ReasonCode,
  ReasonKind,
  Source,
  Status,
} from "../src";

export type FixtureReason = {
  code: ReasonCode;
  kind: ReasonKind;
  summary?: string;
  src: string[];
};
export type FixtureEvent = {
  type: EventType;
  status: Status;
  d: [string | null, string | null];
  reasons: FixtureReason[];
  next?: { name: string; loc?: string; addr?: string };
  evidence: { claim: Claim; src: string }[];
};
export type FixtureOccupant = {
  name: string;
  bt?: BusinessType;
  from: string | null;
  to: string | null;
  yrs?: number;
  chain?: boolean;
  event?: FixtureEvent;
  src: string[];
};
export type FixtureLocation = {
  id: string;
  addr: string;
  ll: [number, number];
  hood: string;
  sources: Record<string, Source>;
  occupants: FixtureOccupant[];
};

const RETRIEVED = "2026-09-23";

const dinesafe: Source = {
  kind: "dataset",
  title: "DineSafe",
  publisher: "City of Toronto",
  url: "https://open.toronto.ca/dataset/dinesafe/",
  date: RETRIEVED,
};
const licences: Source = {
  kind: "dataset",
  title: "Municipal Licensing and Standards - Business Licences and Permits",
  publisher: "City of Toronto",
  url: "https://open.toronto.ca/dataset/municipal-licensing-and-standards-business-licences-and-permits/",
  date: RETRIEVED,
};
const blogto = (path: string, title: string, date: string): Source => ({
  kind: "news_article",
  title,
  publisher: "blogTO",
  url: `https://www.blogto.com/eat_drink/${path}/`,
  date,
});

export const TORONTO_FIXTURE: FixtureLocation[] = [
  {
    id: "tor-176-dupont-st",
    addr: "176 Dupont St",
    ll: [-79.40367, 43.67574],
    hood: "Annex",
    sources: {
      news: blogto(
        "2022/06/rose-sons-big-crow-toronto-closed",
        "Toronto chef just permanently closed two popular restaurants with almost no warning",
        "2022-06-29",
      ),
      licences,
      dinesafe,
    },
    occupants: [
      {
        name: "People's Foods",
        from: "2005-07-11",
        to: "2012-11-02",
        src: ["licences"],
      },
      {
        name: "Rose and Sons",
        bt: "restaurant",
        from: "2012-11-02",
        to: "2022-06-26",
        yrs: 10,
        src: ["licences"],
        event: {
          type: "permanent",
          status: "closed",
          d: ["2022-06-26", "2022-06-26"],
          reasons: [
            {
              code: "unknown",
              kind: "stated",
              summary:
                "Owner chose to focus on his other restaurants; said he wasn't blaming COVID or inflation",
              src: ["news"],
            },
          ],
          next: { name: "Chilliy Pepper" },
          evidence: [
            { claim: "closed", src: "news" },
            { claim: "closed", src: "licences" },
            { claim: "successor", src: "licences" },
          ],
        },
      },
      {
        name: "Big Crow",
        bt: "restaurant",
        from: null,
        to: "2022-06-26",
        src: ["news"],
        event: {
          type: "permanent",
          status: "closed",
          d: ["2022-06-26", "2022-06-26"],
          reasons: [
            {
              code: "unknown",
              kind: "stated",
              summary:
                "Owner chose to focus on his other restaurants; said he wasn't blaming COVID or inflation",
              src: ["news"],
            },
          ],
          evidence: [{ claim: "closed", src: "news" }],
        },
      },
      {
        name: "Chilliy Pepper",
        bt: "restaurant",
        from: "2023-06-19",
        to: null,
        src: ["licences", "dinesafe"],
      },
    ],
  },
  {
    id: "tor-399-roncesvalles-ave",
    addr: "399 Roncesvalles Ave",
    ll: [-79.45057, 43.65089],
    hood: "Roncesvalles",
    sources: {
      news: blogto(
        "2022/08/sweet-thrills-toronto-closed",
        "Toronto candy store that was open for 25 years permanently closes due to rent increase",
        "2022-08-07",
      ),
      licences,
      dinesafe,
    },
    occupants: [
      {
        name: "Sweet Thrills",
        bt: "food_retail",
        from: "2003-05-01",
        to: "2022-07-31",
        yrs: 24,
        src: ["licences"],
        event: {
          type: "relocated",
          status: "closed",
          d: ["2022-07-31", "2022-07-31"],
          reasons: [
            {
              code: "rent_lease",
              kind: "stated",
              summary:
                "Landlord suddenly raised the rent beyond what the store could afford",
              src: ["news"],
            },
          ],
          next: {
            name: "Sweet Thrills",
            loc: "tor-367-roncesvalles-ave",
            addr: "367 Roncesvalles Ave",
          },
          evidence: [
            { claim: "closed", src: "news" },
            { claim: "closed", src: "licences" },
            { claim: "relocated", src: "dinesafe" },
          ],
        },
      },
    ],
  },
  {
    id: "tor-367-roncesvalles-ave",
    addr: "367 Roncesvalles Ave",
    ll: [-79.45028, 43.65007],
    hood: "Roncesvalles",
    sources: { dinesafe, licences },
    occupants: [
      {
        name: "Sweet Thrills",
        bt: "food_retail",
        from: "2024-03-22",
        to: null,
        src: ["dinesafe", "licences"],
      },
    ],
  },
  {
    id: "tor-2120-queen-st-e",
    addr: "2120 Queen St E",
    ll: [-79.29476, 43.67136],
    hood: "The Beaches",
    sources: {
      news: blogto(
        "2022/11/green-basil-toronto-closed",
        "Last location for Toronto Thai restaurant permanently closes after over 15 years",
        "2022-11-14",
      ),
      licences,
      dinesafe,
    },
    occupants: [
      {
        name: "Green Basil",
        bt: "restaurant",
        from: "2020-12-17",
        to: "2022-10-30",
        yrs: 15,
        src: ["licences"],
        event: {
          type: "permanent",
          status: "closed",
          d: ["2022-10-30", "2022-10-30"],
          reasons: [],
          next: { name: "Mehfill Indian Cuisine" },
          evidence: [
            { claim: "closed", src: "news" },
            { claim: "closed", src: "licences" },
            { claim: "successor", src: "licences" },
          ],
        },
      },
      {
        // Found from the licence cancellation alone: no news coverage, no stated reason.
        name: "Mehfill Indian Cuisine",
        bt: "restaurant",
        from: "2023-04-14",
        to: "2025-07-02",
        chain: true,
        src: ["licences"],
        event: {
          type: "permanent",
          status: "closed",
          d: [null, "2025-07-02"],
          reasons: [],
          next: { name: "Original Banana Leaf" },
          evidence: [
            { claim: "closed", src: "licences" },
            { claim: "successor", src: "dinesafe" },
          ],
        },
      },
      {
        name: "Original Banana Leaf",
        bt: "restaurant",
        from: "2026-05-26",
        to: null,
        src: ["dinesafe", "licences"],
      },
    ],
  },
  {
    id: "tor-224-parliament-st",
    addr: "224 Parliament St",
    ll: [-79.36532, 43.65715],
    hood: "Moss Park",
    sources: { licences, dinesafe },
    occupants: [
      {
        name: "Kabul Naan Kabob",
        bt: "restaurant",
        from: "2019-03-26",
        to: "2022-09-08",
        src: ["licences"],
        event: {
          type: "permanent",
          status: "closed",
          d: [null, "2022-09-08"],
          reasons: [],
          next: { name: "Wanaag Restaurant" },
          evidence: [
            { claim: "closed", src: "licences" },
            { claim: "successor", src: "licences" },
          ],
        },
      },
      {
        name: "Wanaag Restaurant",
        bt: "restaurant",
        from: "2022-09-08",
        to: null,
        src: ["licences", "dinesafe"],
      },
    ],
  },
  {
    id: "tor-1802-pharmacy-ave",
    addr: "1802 Pharmacy Ave",
    ll: [-79.31777, 43.7756],
    hood: "Tam O'Shanter-Sullivan",
    sources: {
      news: blogto(
        "2023/01/le-cafe-michi-toronto-closing",
        "Sushi restaurant permanently closing after decades in Toronto",
        "2023-01-24",
      ),
      dinesafe,
    },
    occupants: [
      {
        name: "Le Cafe Michi",
        bt: "restaurant",
        from: null,
        to: "2023-01-31",
        src: ["dinesafe"],
        event: {
          type: "permanent",
          status: "closed",
          d: ["2023-01-31", "2023-01-31"],
          reasons: [
            {
              code: "owner_retirement",
              kind: "stated",
              summary:
                "Longtime staff are retiring and the owners' children aren't taking over",
              src: ["news"],
            },
          ],
          evidence: [
            { claim: "closed", src: "news" },
            { claim: "closed", src: "dinesafe" },
          ],
        },
      },
    ],
  },
  {
    id: "tor-1260-bloor-st-w",
    addr: "1260 Bloor St W",
    ll: [-79.44055, 43.65899],
    hood: "Junction-Wallace Emerson",
    sources: {
      news: blogto(
        "2023/06/brock-sandwich-closing",
        "Popular sandwich shop permanently closing after almost a decade in Toronto",
        "2023-06-03",
      ),
      licences,
    },
    occupants: [
      {
        name: "Brock Sandwich",
        bt: "take_out",
        from: "2013-07-17",
        to: "2023-06-24",
        yrs: 10,
        src: ["licences"],
        event: {
          type: "permanent",
          status: "closed",
          d: ["2023-06-24", "2023-06-24"],
          reasons: [
            {
              code: "rent_lease",
              kind: "stated",
              summary:
                "Month-to-month lease with a large increase expected after landlord renovations",
              src: ["news"],
            },
            {
              code: "financial",
              kind: "stated",
              summary: "Pandemic-era debt and food costs up 25 to 35 per cent",
              src: ["news"],
            },
            {
              code: "pandemic",
              kind: "stated",
              summary: "Debt built up during COVID closures",
              src: ["news"],
            },
          ],
          next: { name: "IBET Sushi" },
          evidence: [
            { claim: "closed", src: "news" },
            { claim: "closed", src: "licences" },
            { claim: "successor", src: "licences" },
          ],
        },
      },
      {
        name: "IBET Sushi",
        bt: "restaurant",
        from: "2023-10-05",
        to: null,
        src: ["licences"],
      },
    ],
  },
  {
    id: "tor-3150-dufferin-st-unit-102",
    addr: "3150 Dufferin St, Unit 102",
    ll: [-79.4556, 43.71717],
    hood: "Yorkdale-Glen Park",
    sources: {
      news: blogto(
        "2023/10/swiss-chalet-toronto-dinesafe",
        "Swiss Chalet shut down by Toronto health inspectors days before Thanksgiving",
        "2023-10-06",
      ),
      dinesafe,
      licences,
    },
    occupants: [
      {
        name: "Swiss Chalet",
        bt: "restaurant",
        from: "2011-09-22",
        to: null,
        chain: true,
        src: ["licences", "dinesafe"],
        event: {
          type: "temporary",
          status: "reopened",
          d: ["2023-10-04", "2023-10-04"],
          reasons: [
            {
              code: "health_enforcement",
              kind: "documented",
              summary:
                "DineSafe closed notice after 14 infractions, including insects",
              src: ["dinesafe", "news"],
            },
          ],
          evidence: [
            { claim: "closed", src: "news" },
            { claim: "reopened", src: "dinesafe" },
          ],
        },
      },
    ],
  },
  {
    id: "tor-46-blue-jays-way",
    addr: "46 Blue Jays Way",
    ll: [-79.39211, 43.64553],
    hood: "Wellington Place",
    sources: {
      news: blogto(
        "2024/01/wahlburgers-toronto-closed",
        "Mark Wahlberg's burger chain permanently closes Toronto location",
        "2024-01-16",
      ),
      licences,
      dinesafe,
    },
    occupants: [
      {
        name: "Wahlburgers",
        bt: "restaurant",
        from: null,
        to: "2024-01-16",
        yrs: 9,
        chain: true,
        src: ["licences", "dinesafe"],
        event: {
          type: "permanent",
          status: "closed",
          d: ["2024-01-01", "2024-01-16"],
          reasons: [
            {
              code: "unknown",
              kind: "stated",
              summary:
                "Staff said the decision came about organically as the business evolved",
              src: ["news"],
            },
          ],
          evidence: [
            { claim: "closed", src: "news" },
            { claim: "closed", src: "licences" },
          ],
        },
      },
    ],
  },
  {
    id: "tor-165-east-liberty-st",
    addr: "165 East Liberty St",
    ll: [-79.41722, 43.63831],
    hood: "Fort York-Liberty Village",
    sources: {
      // Mentioned in passing in an article about a different Popeyes; found by the extraction model.
      news: blogto(
        "2024/01/popeyes-bloor-toronto",
        "Popeyes location in Toronto shut down for non payment of rent has seemingly reopened",
        "2024-01-28",
      ),
      dinesafe,
    },
    occupants: [
      {
        name: "Popeyes Louisiana Kitchen",
        bt: "take_out",
        from: null,
        to: "2022-12-31",
        chain: true,
        src: ["dinesafe"],
        event: {
          type: "permanent",
          status: "closed",
          d: ["2022-08-09", "2022-12-31"],
          reasons: [
            {
              code: "rent_lease",
              kind: "stated",
              summary:
                "Landlord seized the unit over more than $100,000 in unpaid rent",
              src: ["news"],
            },
          ],
          evidence: [
            { claim: "closed", src: "news" },
            { claim: "closed", src: "dinesafe" },
          ],
        },
      },
    ],
  },
  {
    id: "tor-74-ossington-ave",
    addr: "74 Ossington Ave",
    ll: [-79.4198, 43.64582],
    hood: "Trinity-Bellwoods",
    sources: {
      news: blogto(
        "2024/08/ghost-chicken-toronto-closed-new-bar",
        "Toronto restaurant known for its chicken sandwiches has closed and is becoming a bar",
        "2024-08-03",
      ),
      licences,
      dinesafe,
    },
    occupants: [
      {
        name: "Hungry Amoo",
        from: "2016-07-28",
        to: "2018-10-28",
        src: ["licences"],
      },
      {
        name: "Ghost Chicken",
        bt: "restaurant",
        from: "2022-02-01",
        to: "2024-06-30",
        yrs: 2,
        src: ["licences", "dinesafe"],
        event: {
          type: "format_change",
          status: "closed",
          d: ["2024-06-01", "2024-06-30"],
          reasons: [],
          next: { name: "No Vacancy" },
          evidence: [
            { claim: "closed", src: "news" },
            { claim: "successor", src: "dinesafe" },
          ],
        },
      },
      {
        name: "No Vacancy",
        bt: "bar",
        from: "2024-10-10",
        to: null,
        src: ["dinesafe", "licences"],
      },
    ],
  },
  {
    id: "tor-875-queen-st-w",
    addr: "875 Queen St W",
    ll: [-79.4113, 43.64562],
    hood: "West Queen West",
    sources: {
      news: blogto(
        "2025/01/noce-toronto-closed",
        "Toronto restaurant that closed after almost 30 years will soon be replaced",
        "2025-01-29",
      ),
      licences,
      dinesafe,
    },
    occupants: [
      {
        name: "Noce",
        bt: "restaurant",
        from: "2001-03-26",
        to: "2024-11-30",
        yrs: 28,
        src: ["licences", "dinesafe"],
        event: {
          type: "permanent",
          status: "closed",
          d: ["2024-09-01", "2024-11-30"],
          reasons: [],
          next: { name: "Little Ese" },
          evidence: [
            { claim: "closed", src: "news" },
            { claim: "closed", src: "licences" },
            { claim: "successor", src: "licences" },
          ],
        },
      },
      {
        name: "Little Ese",
        bt: "restaurant",
        from: "2025-02-11",
        to: null,
        src: ["licences", "dinesafe"],
      },
    ],
  },
  {
    id: "tor-184-augusta-ave",
    addr: "184 Augusta Ave",
    ll: [-79.4019, 43.65402],
    hood: "Kensington-Chinatown",
    sources: {
      news: blogto(
        "2025/02/amadeus-restaurant-toronto-shuts-down",
        "Restaurant with legendary patio abruptly shuts down after 36 years in Toronto",
        "2025-02-06",
      ),
      dinesafe,
    },
    occupants: [
      {
        name: "Amadeu's Restaurant",
        bt: "restaurant",
        from: null,
        to: "2025-02-04",
        yrs: 36,
        src: ["dinesafe"],
        event: {
          type: "permanent",
          status: "closed",
          d: ["2025-02-04", "2025-02-04"],
          reasons: [
            {
              code: "owner_retirement",
              kind: "stated",
              summary: "Owner, 75, is retiring to spend time with family",
              src: ["news"],
            },
            {
              code: "sale",
              kind: "stated",
              summary: "Owners decided to sell the restaurant",
              src: ["news"],
            },
          ],
          next: { name: "Burdock Brewery Kensington Tavern" },
          evidence: [
            { claim: "closed", src: "news" },
            { claim: "successor", src: "dinesafe" },
          ],
        },
      },
      {
        name: "Burdock Brewery Kensington Tavern",
        bt: "bar",
        from: "2025-06-13",
        to: null,
        src: ["dinesafe"],
      },
    ],
  },
  {
    id: "tor-26-market-st",
    addr: "26 Market St",
    ll: [-79.37213, 43.64901],
    hood: "St Lawrence-East Bayfront-The Islands",
    sources: {
      news: blogto(
        "2025/04/bar-st-lo-toronto-closing",
        "Toronto bar that was a neighbourhood staple closing for good this week",
        "2025-04-22",
      ),
      licences,
    },
    occupants: [
      {
        name: "Barsa Taberna",
        from: "2013-10-30",
        to: "2021-07-29",
        src: ["licences"],
      },
      {
        name: "Bar St. Lo",
        bt: "bar",
        from: "2021-07-29",
        to: "2025-04-27",
        yrs: 4,
        src: ["licences"],
        event: {
          type: "permanent",
          status: "closed",
          d: ["2025-04-27", "2025-04-27"],
          reasons: [
            {
              code: "sale",
              kind: "stated",
              summary: "Owners accepted an offer they couldn't refuse",
              src: ["news"],
            },
          ],
          next: { name: "Anejo Restaurant" },
          evidence: [
            { claim: "closed", src: "news" },
            { claim: "closed", src: "licences" },
            { claim: "successor", src: "licences" },
          ],
        },
      },
      {
        name: "Anejo Restaurant",
        bt: "restaurant",
        from: "2025-05-01",
        to: null,
        src: ["licences"],
      },
    ],
  },
  {
    id: "tor-615-queen-st-w",
    addr: "615 Queen St W",
    ll: [-79.40256, 43.64728],
    hood: "Wellington Place",
    sources: {
      news: blogto(
        "2025/08/toronto-food-alley-closed",
        "Toronto food alley that just opened on a buzzy strip last year has closed down",
        "2025-08-15",
      ),
      licences,
    },
    occupants: [
      {
        name: "The Food Alley",
        bt: "market",
        from: null,
        to: "2025-08-15",
        src: ["news"],
        event: {
          type: "permanent",
          status: "closed",
          d: ["2025-08-01", "2025-08-15"],
          reasons: [],
          next: { name: "Queen's Bloc" },
          evidence: [
            { claim: "closed", src: "news" },
            { claim: "successor", src: "licences" },
          ],
        },
      },
      {
        name: "Queen's Bloc",
        bt: "market",
        from: "2025-09-16",
        to: null,
        src: ["licences"],
      },
    ],
  },
  {
    id: "tor-400-bloor-st-w",
    addr: "400 Bloor St W",
    ll: [-79.40756, 43.66599],
    hood: "Annex",
    sources: {
      news: blogto(
        "2025/08/by-the-way-cafe-closing-toronto",
        "Legendary Toronto bistro and brunch spot is shutting down after 40 years in business",
        "2025-08-19",
      ),
      licences,
      dinesafe,
    },
    occupants: [
      {
        name: "By The Way",
        bt: "restaurant",
        from: "1987-07-14",
        to: "2025-08-31",
        yrs: 40,
        src: ["licences", "dinesafe"],
        event: {
          type: "permanent",
          status: "closed",
          d: ["2025-08-31", "2025-08-31"],
          reasons: [
            {
              code: "unknown",
              kind: "stated",
              summary:
                "Owners said the family decided it was time for a new chapter",
              src: ["news"],
            },
          ],
          next: { name: "Brasserie Cote Co" },
          evidence: [
            { claim: "closed", src: "news" },
            { claim: "closed", src: "licences" },
            { claim: "successor", src: "licences" },
          ],
        },
      },
      {
        name: "Brasserie Cote Co",
        bt: "restaurant",
        from: "2026-01-16",
        to: null,
        src: ["licences"],
      },
    ],
  },
  {
    id: "tor-1276-queen-st-e",
    addr: "1276 Queen St E",
    ll: [-79.32884, 43.66385],
    hood: "South Riverdale",
    sources: {
      news: blogto(
        "2026/01/daddys-chicken-toronto-eviction",
        "Toronto restaurant forced to close after 'eviction by extortion' from landlord",
        "2026-01-13",
      ),
      licences,
      dinesafe,
    },
    occupants: [
      {
        name: "The Hummingbird Caribbean Cuisine",
        from: "2012-10-23",
        to: "2015-01-23",
        src: ["licences"],
      },
      {
        // The licence is still active: cancellations can lag a closure by months.
        name: "Daddy's Chicken",
        bt: "restaurant",
        from: "2015-09-04",
        to: "2026-02-28",
        yrs: 10,
        src: ["licences", "dinesafe"],
        event: {
          type: "permanent",
          status: "closed",
          d: ["2025-12-20", "2026-02-28"],
          reasons: [
            {
              code: "rent_lease",
              kind: "stated",
              summary:
                "Owner says the landlord evicted them after they refused to pay for a furnace replacement",
              src: ["news"],
            },
          ],
          evidence: [{ claim: "closed", src: "news" }],
        },
      },
    ],
  },
  {
    id: "tor-1426-danforth-ave",
    addr: "1426 Danforth Ave",
    ll: [-79.3271, 43.68289],
    hood: "Danforth",
    sources: {
      news: blogto(
        "2026/02/taverne-tamblyn-toronto-closed",
        "Beleaguered Toronto restaurant closes permanently months after launching new concept",
        "2026-02-02",
      ),
      licences,
      dinesafe,
    },
    occupants: [
      {
        // A records-only closure with a wide window: last inspection to licence cancellation.
        name: "Sarah's Cafe and Bar",
        bt: "bar",
        from: "1996-03-15",
        to: "2024-05-02",
        src: ["licences", "dinesafe"],
        event: {
          type: "permanent",
          status: "closed",
          d: ["2022-04-13", "2024-05-02"],
          reasons: [],
          next: { name: "Taverne Tamblyn" },
          evidence: [
            { claim: "closed", src: "dinesafe" },
            { claim: "closed", src: "licences" },
            { claim: "successor", src: "dinesafe" },
          ],
        },
      },
      {
        name: "Taverne Tamblyn",
        bt: "restaurant",
        from: "2023-05-24",
        to: "2026-01-25",
        yrs: 4,
        src: ["dinesafe", "licences"],
        event: {
          type: "permanent",
          status: "closed",
          d: ["2026-01-25", "2026-01-25"],
          reasons: [
            {
              code: "sale",
              kind: "stated",
              summary: "Owner sold the business",
              src: ["news"],
            },
            {
              code: "financial",
              kind: "stated",
              summary:
                "Owner had earlier cited thin margins and rising overhead",
              src: ["news"],
            },
          ],
          next: { name: "Loukoumania Cafe" },
          evidence: [
            { claim: "closed", src: "news" },
            { claim: "closed", src: "licences" },
            { claim: "successor", src: "dinesafe" },
          ],
        },
      },
      {
        name: "Loukoumania Cafe",
        bt: "cafe",
        from: "2026-08-20",
        to: null,
        src: ["dinesafe"],
      },
    ],
  },
  {
    id: "tor-820-the-queensway",
    addr: "820 The Queensway",
    ll: [-79.50831, 43.62524],
    hood: "Stonegate-Queensway",
    sources: {
      news: blogto(
        "2026/05/dinos-wood-burning-pizza-toronto-closing",
        "Beloved Toronto pizzeria shares heartfelt note announcing closure after 20 years",
        "2026-05-13",
      ),
      licences,
      dinesafe,
    },
    occupants: [
      {
        name: "Dino's Wood Burning Pizza",
        bt: "restaurant",
        from: "2007-06-15",
        to: null,
        yrs: 20,
        chain: true,
        src: ["licences", "dinesafe"],
        event: {
          type: "permanent",
          status: "announced",
          d: [null, null],
          reasons: [
            {
              code: "sale",
              kind: "stated",
              summary: "This location has been put up for sale",
              src: ["news"],
            },
            {
              code: "financial",
              kind: "stated",
              summary:
                "Owner cited rising costs, weaker spending and competition from chains",
              src: ["news"],
            },
          ],
          evidence: [{ claim: "announced", src: "news" }],
        },
      },
    ],
  },
  {
    id: "tor-116-geary-ave-unit-108a",
    addr: "116 Geary Ave, Unit 108A",
    ll: [-79.43483, 43.67053],
    hood: "Junction-Wallace Emerson",
    sources: {
      news: blogto(
        "2026/07/famiglia-balsassarre-toronto-closing",
        "Toronto's best pasta restaurant just announced it's closing soon",
        "2026-07-15",
      ),
      licences,
      dinesafe,
    },
    occupants: [
      {
        name: "Famiglia Baldassarre",
        bt: "take_out",
        from: "2017-08-31",
        to: "2026-08-14",
        yrs: 9,
        src: ["licences", "dinesafe"],
        event: {
          type: "format_change",
          status: "closed",
          d: ["2026-08-14", "2026-08-14"],
          reasons: [
            {
              code: "unknown",
              kind: "stated",
              summary:
                "Ending lunch service to focus on wholesale pasta; the business continues",
              src: ["news"],
            },
          ],
          evidence: [{ claim: "announced", src: "news" }],
        },
      },
    ],
  },
  {
    id: "tor-769-dundas-st-w",
    addr: "769 Dundas St W",
    ll: [-79.40704, 43.65209],
    hood: "Trinity-Bellwoods",
    sources: { dinesafe, licences },
    occupants: [
      {
        // Records only: inspections stopped, the licence was cancelled 22 months later.
        name: "Subway",
        bt: "restaurant",
        from: "2009-08-14",
        to: "2025-07-09",
        chain: true,
        src: ["licences", "dinesafe"],
        event: {
          type: "permanent",
          status: "closed",
          d: ["2023-09-14", "2025-07-09"],
          reasons: [],
          next: { name: "Wonky Donkey" },
          evidence: [
            { claim: "closed", src: "dinesafe" },
            { claim: "closed", src: "licences" },
            { claim: "successor", src: "licences" },
          ],
        },
      },
      {
        name: "Wonky Donkey",
        bt: "restaurant",
        from: "2025-09-22",
        to: null,
        src: ["licences", "dinesafe"],
      },
    ],
  },
  {
    id: "tor-382-college-st",
    addr: "382 College St",
    ll: [-79.40517, 43.65698],
    hood: "Kensington-Chinatown",
    sources: {
      news: blogto(
        "2026/09/hogtown-vegan-toronto-closed",
        "Popular Toronto vegan restaurant to close permanently after 15 years",
        "2026-09-17",
      ),
      licences,
      dinesafe,
    },
    occupants: [
      {
        name: "Windup Bird",
        from: "2013-09-16",
        to: "2016-11-21",
        src: ["licences"],
      },
      {
        name: "Montreal Bar & Grill",
        from: "2016-11-21",
        to: "2017-09-26",
        src: ["licences"],
      },
      {
        name: "The Hogtown Vegan",
        bt: "restaurant",
        from: "2017-09-26",
        to: "2026-09-27",
        yrs: 15,
        src: ["licences", "dinesafe"],
        event: {
          type: "permanent",
          status: "announced",
          d: ["2026-09-27", "2026-09-27"],
          reasons: [],
          evidence: [{ claim: "announced", src: "news" }],
        },
      },
    ],
  },
  {
    id: "tor-141-berkeley-st",
    addr: "141 Berkeley St",
    ll: [-79.36538, 43.65498],
    hood: "Moss Park",
    sources: {
      news: blogto(
        "2026/09/buvette-pacey-toronto-closing",
        "Toronto cafe-bar closing because operating in the city 'isn't sustainable'",
        "2026-09-04",
      ),
      licences,
      dinesafe,
    },
    occupants: [
      {
        name: "Runner Market",
        from: "2021-05-11",
        to: "2023-08-29",
        src: ["licences", "dinesafe"],
      },
      {
        name: "Buvette Pacey",
        bt: "cafe",
        from: "2023-08-29",
        to: null,
        yrs: 3,
        src: ["licences", "dinesafe"],
        event: {
          type: "permanent",
          status: "announced",
          d: [null, null],
          reasons: [
            {
              code: "financial",
              kind: "stated",
              summary: "Owner cites a weak economy and rising overhead costs",
              src: ["news"],
            },
          ],
          evidence: [{ claim: "announced", src: "news" }],
        },
      },
    ],
  },
];
