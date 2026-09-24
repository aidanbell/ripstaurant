import { useLoaderData } from "react-router";
import { formatRange } from "../../format";
import type { locationLoader } from "../../loaders";

export function LocationPage() {
  const location = useLoaderData<typeof locationLoader>();
  return (
    <section>
      <h1>{location.addr}</h1>
      <p>{location.hood}</p>
      <h2>Who was here</h2>
      <ul>
        {location.occupants.map((o) => (
          <li key={`${o.name}-${o.from ?? ""}`}>
            {o.name}: {o.from ?? "?"} to {o.to ?? "present"}
            {o.event &&
              `, ${o.event.type} (${o.event.status}, ${formatRange(o.event.d)})`}
          </li>
        ))}
      </ul>
      <h2>Sources</h2>
      <ul>
        {location.sources.map((s) => (
          <li key={s.url}>
            <a href={s.url}>{s.title}</a>, {s.publisher}
            {s.date && `, retrieved ${s.date}`}
          </li>
        ))}
      </ul>
    </section>
  );
}
