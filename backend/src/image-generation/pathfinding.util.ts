import { Edge, Poi } from '../maps/schemas/map.schema';

/**
 * Devuelve la arista que conecta dos POIs (en cualquier sentido), o
 * `undefined` si no existe una conexión directa entre ellos.
 */
export function findEdgeBetween(edges: Edge[], aId: string, bId: string): Edge | undefined {
  return edges.find(
    (e) =>
      (e.fromPoiId === aId && e.toPoiId === bId) || (e.fromPoiId === bId && e.toPoiId === aId),
  );
}

/**
 * Longitud total de una arista siguiendo sus waypoints (si los tiene) en
 * lugar de la distancia recta entre los dos POIs que conecta. Se usa tanto
 * para el peso en Dijkstra como para saber cuánto "cuesta" recorrer el
 * camino real dibujado por el usuario.
 */
export function edgePolylineLength(edge: Edge, a: Poi, b: Poi): number {
  const points = [{ x: a.x, y: a.y }, ...(edge.waypoints ?? []), { x: b.x, y: b.y }];
  let total = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    total += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
  }
  return total;
}

/**
 * Calcula el camino más corto (por longitud real del trazado, incluyendo
 * waypoints) entre un POI de origen y el POI marcado como entrada
 * principal, utilizando el algoritmo de Dijkstra sobre el grafo no
 * dirigido definido por `edges`.
 *
 * Devuelve la lista ordenada de POIs que conforman el camino (incluyendo
 * origen y destino), o `null` si no existe conexión entre ambos.
 */
export function shortestPathToEntrance(
  pois: Poi[],
  edges: Edge[],
  fromPoiId: string,
): Poi[] | null {
  const entrance = pois.find((p) => p.isEntrance);
  if (!entrance) return null;
  if (fromPoiId === entrance.id) return [entrance];

  const poiById = new Map(pois.map((p) => [p.id, p]));

  // Lista de adyacencia con peso = distancia euclidiana entre POIs
  const adjacency = new Map<string, { neighborId: string; weight: number }[]>();
  for (const poi of pois) adjacency.set(poi.id, []);

  for (const edge of edges) {
    const a = poiById.get(edge.fromPoiId);
    const b = poiById.get(edge.toPoiId);
    if (!a || !b) continue;
    const weight = edgePolylineLength(edge, a, b);
    adjacency.get(a.id)?.push({ neighborId: b.id, weight });
    adjacency.get(b.id)?.push({ neighborId: a.id, weight });
  }

  const distances = new Map<string, number>();
  const previous = new Map<string, string | null>();
  const visited = new Set<string>();

  for (const poi of pois) distances.set(poi.id, Infinity);
  distances.set(fromPoiId, 0);

  while (visited.size < pois.length) {
    let currentId: string | null = null;
    let currentDist = Infinity;
    for (const [id, dist] of distances) {
      if (!visited.has(id) && dist < currentDist) {
        currentDist = dist;
        currentId = id;
      }
    }
    if (currentId === null) break; // resto inalcanzable
    visited.add(currentId);
    if (currentId === entrance.id) break;

    for (const { neighborId, weight } of adjacency.get(currentId) ?? []) {
      if (visited.has(neighborId)) continue;
      const alt = currentDist + weight;
      if (alt < (distances.get(neighborId) ?? Infinity)) {
        distances.set(neighborId, alt);
        previous.set(neighborId, currentId);
      }
    }
  }

  if (distances.get(entrance.id) === Infinity) return null;

  const pathIds: string[] = [];
  let cursor: string | undefined = entrance.id;
  while (cursor !== undefined) {
    pathIds.unshift(cursor);
    if (cursor === fromPoiId) break;
    cursor = previous.get(cursor) ?? undefined;
  }
  if (pathIds[0] !== fromPoiId) return null;

  return pathIds.map((id) => poiById.get(id)!).filter(Boolean);
}
