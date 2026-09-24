const DATASETS = [
  ["DineSafe", "dinesafe"],
  [
    "Business licences and permits",
    "municipal-licensing-and-standards-business-licences-and-permits",
  ],
  ["Building permits: active", "building-permits-active-permits"],
  ["Building permits: cleared", "building-permits-cleared-permits"],
  ["Development applications", "development-applications"],
  ["Address Points", "address-points-municipal-toronto-one-address-repository"],
  ["Neighbourhoods", "neighbourhoods"],
] as const;

export function AboutPage() {
  return (
    <section>
      <h1>About</h1>
      <p>
        RIPstaurant maps Toronto restaurants that have closed since March 2022,
        and why, from City of Toronto open data. Closure dates are ranges: most
        closures are only known to within the time between two public records.
      </p>
      <h2>Sources</h2>
      <ul>
        {DATASETS.map(([title, slug]) => (
          <li key={slug}>
            <a href={`https://open.toronto.ca/dataset/${slug}/`}>{title}</a>,
            City of Toronto
          </li>
        ))}
      </ul>
      <p>
        Contains information licensed under the{" "}
        <a href="https://open.toronto.ca/open-data-license/">
          Open Government Licence – Toronto
        </a>
        .
      </p>
    </section>
  );
}
