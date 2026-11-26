// Hash routes of the scenes (experience spec, Requirement 1). Pure: strings in, routes out.
//
//   #/                         Choose_Scene
//   #/map/<map>                Map_Scene
//   #/map/<map>/run            Run_Scene
//   #/map/<map>/results        Results_Scene
//   #/map/<map>/lab            the lab (experience task 14)
//   #/results                  the "What we measured" page (ui spec), unchanged
//
// Anything else is the Choose_Scene, so every string gives a valid route.

export type MapSlug = "hall" | "kadikoy" | "sf-bus" | "nyc-bike" | "your-map" | "today";

export const MAP_SLUGS: readonly MapSlug[] = ["hall", "kadikoy", "sf-bus", "nyc-bike", "your-map", "today"];

export type MapScene = "map" | "run" | "results" | "lab";

export type Route = { scene: "choose" } | { scene: "measured" } | { scene: MapScene; map: MapSlug };

export function isMapSlug(s: string): s is MapSlug {
  return (MAP_SLUGS as readonly string[]).includes(s);
}

const MAP_ROUTE = /^\/map\/([a-z-]+)(?:\/(run|results|lab))?\/?$/;

/** The route of a location hash ("#/map/hall/run"). Unknown input gives the Choose_Scene. */
export function parseRoute(hash: string): Route {
  const h = hash.startsWith("#") ? hash.slice(1) : hash;
  if (h === "/results") return { scene: "measured" };
  const m = MAP_ROUTE.exec(h);
  if (m && isMapSlug(m[1])) return { scene: (m[2] as MapScene | undefined) ?? "map", map: m[1] };
  return { scene: "choose" };
}

/** The hash of a route. `parseRoute(formatRoute(r))` equals `r`. */
export function formatRoute(r: Route): string {
  if (r.scene === "choose") return "#/";
  if (r.scene === "measured") return "#/results";
  return r.scene === "map" ? `#/map/${r.map}` : `#/map/${r.map}/${r.scene}`;
}

export function sameRoute(a: Route, b: Route): boolean {
  return formatRoute(a) === formatRoute(b);
}
