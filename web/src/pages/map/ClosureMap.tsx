import type {
  Boundaries,
  Boundary,
  CityList,
  ClosureRow,
} from "@ripstaurant/contract";
import type { FeatureCollection, Point } from "geojson";
import { MapLibreMap, NavigationControl, setWorkerUrl } from "maplibre-gl";
import type { GeoJSONSource, MapLayerMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { useEffect, useRef } from "react";
import { cn } from "../../utils/cn";

/**
 * Stand-in basemap for development: OpenFreeMap's hosted style (free, no key; its
 * attribution shows on the map). The self-hosted Protomaps PMTiles basemap from PLAN
 * replaces it at deploy time.
 */
const BASEMAP_STYLE = "https://tiles.openfreemap.org/styles/positron";
// MapLibre builds its worker's URL at runtime, next to its own module, which Vite can't
// see: dependency pre-bundling (dev) and bundling (build) both leave the worker behind.
// `?worker&url` makes Vite bundle it, with the shared chunk it imports, into one script.
setWorkerUrl(workerUrl);

/** A font the basemap's glyph server has, for cluster counts. */
const FONT = "Noto Sans Regular";
const SOURCE = "closures";
const OUTLINE = "outline";
/** Every neighbourhood, invisible until hovered: the click target for picking one. */
const HOODS = "hoods";
/** The selected closure: a ring around its dot, drawn from its own source so it shows
 * even when filters hide the closure itself. */
const FOCUS = "focus";
const FOCUS_ZOOM = 16;
const INK = "#222";
/** --accent (light theme): the ring has to stand out from the ink dots. */
const RING = "#9c4030";
const NOTHING: FeatureCollection = { type: "FeatureCollection", features: [] };

type Properties = { id: string; loc: string; name: string };

/** Rows → GeoJSON in the browser (PLAN: the list file stays compact; this is derived). */
function toGeoJSON(rows: ClosureRow[]): FeatureCollection<Point, Properties> {
  return {
    type: "FeatureCollection",
    features: rows.map((row) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: row.ll },
      properties: { id: row.id, loc: row.loc, name: row.name },
    })),
  };
}

type Box = [west: number, south: number, east: number, north: number];

/** The box around a set of boundaries; null for none. */
function boundsOf(boundaries: readonly Boundary[]): Box | null {
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const boundary of boundaries) {
    const polygons =
      boundary.geometry.type === "Polygon"
        ? [boundary.geometry.coordinates]
        : boundary.geometry.coordinates;
    for (const polygon of polygons)
      for (const ring of polygon)
        for (const [lng, lat] of ring) {
          w = Math.min(w, lng);
          s = Math.min(s, lat);
          e = Math.max(e, lng);
          n = Math.max(n, lat);
        }
  }
  return w === Infinity ? null : [w, s, e, n];
}

function focusData(focus: ClosureRow | null): FeatureCollection {
  if (!focus) return NOTHING;
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: focus.ll },
        properties: {},
      },
    ],
  };
}

/**
 * Outlines the selected neighbourhoods. `fit: "always"` zooms to them (a link that
 * opens on a selection); "if-hidden" only moves when part of the selection is off
 * screen, so picking a visible neighbourhood doesn't jump the map.
 */
function showSelected(
  m: MapLibreMap,
  selected: readonly Boundary[],
  fit: "always" | "if-hidden",
): void {
  m.getSource<GeoJSONSource>(OUTLINE)?.setData({
    type: "FeatureCollection",
    features: [...selected],
  });
  const box = boundsOf(selected);
  if (!box) return;
  const view = m.getBounds();
  const visible =
    view.contains([box[0], box[1]]) && view.contains([box[2], box[3]]);
  if (fit === "always" || !visible) m.fitBounds(box, { padding: 32 });
}

type Props = {
  city: CityList["city"];
  /** Already filtered; the map shows exactly these. */
  rows: ClosureRow[];
  /** Every neighbourhood, for picking on the map; null if the export has none. */
  boundaries: Boundaries | null;
  /** The selected neighbourhoods, outlined. */
  selected: readonly Boundary[];
  /** A neighbourhood was clicked: add it to the selection, or remove it. */
  onToggleHood: (name: string) => void;
  /** The selected closure: ringed, and the map flies to it. */
  focus: ClosureRow | null;
  /** A closure's dot was clicked. */
  onSelect: (id: string) => void;
  /**
   * How much of the map's bottom edge is covered (the sheet on phones), in pixels, so
   * the selected closure is centred in the part that shows.
   */
  coveredBottom?: number;
  className?: string;
};

/**
 * The closures on a map: clusters at low zoom, a point per closure closer in. Clicking a
 * cluster zooms into it; clicking a point selects it. The map is created once; a change
 * of rows only swaps the source's data.
 */
export function ClosureMap({
  city,
  rows,
  boundaries,
  selected,
  onToggleHood,
  focus,
  onSelect,
  coveredBottom = 0,
  className,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  // What the sources should hold, and the latest callback; read by map handlers.
  const current = useRef(rows);
  const currentBoundaries = useRef(boundaries);
  const currentSelected = useRef(selected);
  const toggle = useRef(onToggleHood);
  const select = useRef(onSelect);
  const currentFocus = useRef(focus);
  const covered = useRef(coveredBottom);

  useEffect(() => {
    toggle.current = onToggleHood;
    select.current = onSelect;
    covered.current = coveredBottom;
  }, [onToggleHood, onSelect, coveredBottom]);

  useEffect(() => {
    if (!container.current) return;
    const m = new MapLibreMap({
      container: container.current,
      style: BASEMAP_STYLE,
      // The map page has no footer, so the data licence goes with the basemap's credits.
      attributionControl: {
        compact: true,
        customAttribution:
          '<a href="https://open.toronto.ca/open-data-license/">Contains information licensed under the Open Government Licence – Toronto</a>',
      },
      bounds: city.bbox,
      fitBoundsOptions: { padding: 16 },
      maxBounds: [
        [city.bbox[0] - 0.5, city.bbox[1] - 0.5],
        [city.bbox[2] + 0.5, city.bbox[3] + 0.5],
      ],
    });
    m.addControl(new NavigationControl({ showCompass: false }));

    // As soon as the style is ready, not on "load" (which waits for the basemap's tiles),
    // so the closures don't depend on the basemap loading.
    m.on("style.load", () => {
      // Beneath the closures: the neighbourhoods to pick from, then the selection.
      m.addSource(HOODS, {
        type: "geojson",
        data: currentBoundaries.current ?? NOTHING,
        generateId: true,
      });
      m.addLayer({
        id: HOODS,
        type: "fill",
        source: HOODS,
        paint: {
          "fill-color": INK,
          "fill-opacity": [
            "case",
            ["boolean", ["feature-state", "hover"], false],
            0.08,
            0,
          ],
        },
      });
      m.addSource(OUTLINE, { type: "geojson", data: NOTHING });
      m.addLayer({
        id: OUTLINE,
        type: "line",
        source: OUTLINE,
        paint: { "line-color": INK, "line-width": 2 },
      });
      // A link to a closure opens on it; otherwise on the selected neighbourhoods.
      const initialFocus = currentFocus.current;
      showSelected(
        m,
        currentSelected.current,
        initialFocus ? "if-hidden" : "always",
      );
      if (initialFocus) {
        m.jumpTo({ center: initialFocus.ll, zoom: FOCUS_ZOOM });
        // Up into the part of the map the sheet doesn't cover.
        m.panBy([0, covered.current / 2], { duration: 0 });
      }
      m.addSource(SOURCE, {
        type: "geojson",
        data: toGeoJSON(current.current),
        cluster: true,
        clusterRadius: 40,
        clusterMaxZoom: 14,
      });
      m.addLayer({
        id: "clusters",
        type: "circle",
        source: SOURCE,
        filter: ["has", "point_count"],
        paint: {
          "circle-color": INK,
          "circle-opacity": 0.75,
          "circle-radius": [
            "step",
            ["get", "point_count"],
            12,
            50,
            18,
            250,
            24,
          ],
        },
      });
      m.addLayer({
        id: "cluster-count",
        type: "symbol",
        source: SOURCE,
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-font": [FONT],
          "text-size": 12,
        },
        paint: { "text-color": "#fff" },
      });
      m.addLayer({
        id: "points",
        type: "circle",
        source: SOURCE,
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": INK,
          "circle-radius": 5,
          "circle-stroke-color": "#fff",
          "circle-stroke-width": 1,
        },
      });
      m.addSource(FOCUS, { type: "geojson", data: focusData(initialFocus) });
      m.addLayer({
        id: FOCUS,
        type: "circle",
        source: FOCUS,
        paint: {
          "circle-radius": 10,
          "circle-opacity": 0,
          "circle-stroke-color": RING,
          "circle-stroke-width": 3,
        },
      });
    });

    m.on("click", "clusters", async (e: MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      const id = feature?.properties?.cluster_id;
      const source = m.getSource<GeoJSONSource>(SOURCE);
      if (!feature || typeof id !== "number" || !source) return;
      const zoom = await source.getClusterExpansionZoom(id);
      m.easeTo({ center: e.lngLat, zoom });
    });
    m.on("click", "points", (e: MapLayerMouseEvent) => {
      const id = e.features?.[0]?.properties?.id;
      if (typeof id === "string") select.current(id);
    });
    // Picking a neighbourhood: a click that isn't on a closure or a cluster.
    m.on("click", HOODS, (e: MapLayerMouseEvent) => {
      const onClosure = m.queryRenderedFeatures(e.point, {
        layers: ["clusters", "points"],
      }).length;
      const name = e.features?.[0]?.properties?.name;
      if (!onClosure && typeof name === "string") toggle.current(name);
    });
    let hovered: string | number | undefined;
    const unhover = () => {
      if (hovered !== undefined)
        m.setFeatureState({ source: HOODS, id: hovered }, { hover: false });
      hovered = undefined;
    };
    m.on("mousemove", HOODS, (e: MapLayerMouseEvent) => {
      const id = e.features?.[0]?.id;
      if (id === hovered) return;
      unhover();
      if (id === undefined) return;
      hovered = id;
      m.setFeatureState({ source: HOODS, id }, { hover: true });
    });
    m.on("mouseleave", HOODS, unhover);

    for (const layer of ["clusters", "points", HOODS]) {
      m.on("mouseenter", layer, () => (m.getCanvas().style.cursor = "pointer"));
      m.on("mouseleave", layer, () => (m.getCanvas().style.cursor = ""));
    }

    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
  }, [city]);

  useEffect(() => {
    currentFocus.current = focus;
    const m = map.current;
    // Before the style has loaded there's no source; the style.load handler shows it.
    const source = m?.getSource<GeoJSONSource>(FOCUS);
    if (!m || !source) return;
    source.setData(focusData(focus));
    // Closer in if needed, never back out. MapLibre skips the animation for anyone who
    // prefers reduced motion.
    if (focus)
      m.flyTo({
        center: focus.ll,
        zoom: Math.max(m.getZoom(), FOCUS_ZOOM),
        offset: [0, -covered.current / 2],
      });
  }, [focus]);

  useEffect(() => {
    currentSelected.current = selected;
    // Before the style has loaded there's no source; the style.load handler shows it.
    if (map.current?.getSource(OUTLINE))
      showSelected(map.current, selected, "if-hidden");
  }, [selected]);

  useEffect(() => {
    current.current = rows;
    // Before the style has loaded there's no source yet; the style.load handler reads `current`.
    map.current?.getSource<GeoJSONSource>(SOURCE)?.setData(toGeoJSON(rows));
  }, [rows]);

  return (
    <div
      ref={container}
      role="region"
      aria-label={`Map of ${rows.length} closures`}
      className={cn("w-full h-[70vh]", className)}
    />
  );
}
