import { useLoaderData } from "react-router";
import { describeClosure, describeStay } from "../../format";
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
            {o.name}: {describeStay(o.from, o.to)}
            {o.event &&
              `. ${o.event.type}: ${describeClosure(o.event.d, o.event.status)}`}
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
