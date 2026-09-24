// Toronto's open data portal runs CKAN. Resource ids can change when the City
// republishes a dataset, so downloads are looked up by resource name on every run.

import { z } from "zod";

const API = "https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action";

export const USER_AGENT =
  "ripstaurant-pipeline (+https://github.com/aidanbell/ripstaurant)";

const PackageShow = z.object({
  result: z.object({
    resources: z.array(z.object({ name: z.string(), url: z.url() })),
  }),
});

export async function resourceUrl(pkg: string, name: string): Promise<string> {
  const res = await fetch(`${API}/package_show?id=${encodeURIComponent(pkg)}`, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!res.ok) throw new Error(`CKAN ${pkg}: HTTP ${res.status}`);
  const { resources } = PackageShow.parse(await res.json()).result;
  const resource = resources.find((r) => r.name === name);
  if (!resource)
    throw new Error(
      `CKAN ${pkg}: no resource "${name}" (has: ${resources.map((r) => r.name).join(", ")})`,
    );
  return resource.url;
}
