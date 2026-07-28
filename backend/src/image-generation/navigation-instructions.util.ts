import { Edge, Poi, Zone } from '../maps/schemas/map.schema';
import { findEdgeBetween } from './pathfinding.util';

/**
 * Devuelve la zona más chica (por área) que contiene el punto (x, y), o
 * `undefined` si el punto no cae dentro de ninguna zona. Se usa como
 * fallback de referencia para los tramos de ruta que no pasan por un POI
 * con nombre: si dos zonas se solapan en ese punto, gana la más chica,
 * porque es la referencia más específica (ej. un "Baño" dentro de un
 * "Pasillo Este" más grande).
 */
export function findZoneAt(zones: Zone[], x: number, y: number): Zone | undefined {
  let best: Zone | undefined;
  let bestArea = Infinity;
  for (const zone of zones) {
    const withinX = x >= zone.x && x <= zone.x + zone.width;
    const withinY = y >= zone.y && y <= zone.y + zone.height;
    if (!withinX || !withinY) continue;
    const area = zone.width * zone.height;
    if (area < bestArea) {
      bestArea = area;
      best = zone;
    }
  }
  return best;
}

type TurnType =
  | 'girar_derecha_leve'
  | 'girar_derecha'
  | 'girar_izquierda_leve'
  | 'girar_izquierda'
  | 'dar_vuelta';

/**
 * Punto de la ruta ya "aplanada": puede ser un POI (con nombre, para usar
 * como referencia) o un waypoint intermedio sin nombre.
 */
interface RoutePoint {
  x: number;
  y: number;
  name?: string;
}

// Umbral (en grados) por debajo del cual un cambio de dirección se
// considera "ruido" (zigzag de waypoints muy juntos) y se aplana en vez
// de generar una instrucción de giro.
const ZIGZAG_THRESHOLD_DEG = 12;
// Por encima de este ángulo (grados) se considera un giro "leve".
const SLIGHT_TURN_THRESHOLD_DEG = 40;
// Por encima de este ángulo (grados) se considera "dar la vuelta" (giro en U).
const U_TURN_THRESHOLD_DEG = 135;

/**
 * Construye la lista de puntos de la ruta en sentido ENTRADA -> POI
 * destino, intercalando los waypoints de cada arista en el orden
 * correcto (sin importar en qué sentido se haya guardado la arista).
 *
 * `routeNodeToEntrance` es la salida de `shortestPathToEntrance` (que
 * calcula el camino en sentido POI -> entrada); acá se invierte porque
 * las instrucciones siempre se narran de la entrada hacia el nodo.
 *
 * Los waypoints (puntos sin nombre de POI) que caen dentro de una zona
 * reciben el nombre de esa zona como fallback de referencia (ver
 * `findZoneAt`): a partir de ahí se comportan igual que un POI con
 * nombre en el resto del pipeline (no se descartan por zigzag, y se usan
 * como `referencia` en las instrucciones).
 */
function buildRoutePoints(routeNodeToEntrance: Poi[], edges: Edge[], zones: Zone[]): RoutePoint[] {
  const routeEntranceToNode = [...routeNodeToEntrance].reverse();
  const points: RoutePoint[] = [];

  for (let i = 0; i < routeEntranceToNode.length; i += 1) {
    const poi = routeEntranceToNode[i];
    points.push({ x: poi.x, y: poi.y, name: poi.name });

    const next = routeEntranceToNode[i + 1];
    if (!next) continue;

    const edge = findEdgeBetween(edges, poi.id, next.id);
    if (edge && edge.waypoints.length > 0) {
      // Los waypoints se guardan en sentido fromPoiId -> toPoiId; si en
      // esta ruta recorremos la arista al revés, hay que invertirlos.
      const orderedWaypoints =
        edge.fromPoiId === poi.id ? edge.waypoints : [...edge.waypoints].reverse();
      for (const wp of orderedWaypoints) {
        const zone = zones.length > 0 ? findZoneAt(zones, wp.x, wp.y) : undefined;
        points.push({ x: wp.x, y: wp.y, name: zone?.name });
      }
    }
  }

  return points;
}

function distance(a: RoutePoint, b: RoutePoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Ángulo de giro (en grados, con signo) al pasar por `curr`, viniendo
 * desde `prev` y yendo hacia `next`. Positivo = giro a la derecha,
 * negativo = giro a la izquierda (ver comentario más abajo sobre por qué).
 */
function turnAngleDegrees(prev: RoutePoint, curr: RoutePoint, next: RoutePoint): number {
  const v1 = { x: curr.x - prev.x, y: curr.y - prev.y };
  const v2 = { x: next.x - curr.x, y: next.y - curr.y };
  const cross = v1.x * v2.y - v1.y * v2.x;
  const dot = v1.x * v2.x + v1.y * v2.y;
  // Nota sobre el signo: las coordenadas del plano son coordenadas de
  // imagen (Y crece hacia abajo). Con esa orientación, este cálculo da
  // ángulo positivo cuando el giro es hacia la DERECHA de la persona que
  // camina (ej: yendo hacia el este y girando para ir hacia el sur en el
  // plano = giro a la derecha), y negativo cuando es hacia la izquierda.
  return (Math.atan2(cross, dot) * 180) / Math.PI;
}

/**
 * Reduce la lista de puntos "crudos" (POIs + todos los waypoints)
 * fusionando los waypoints cuyo cambio de dirección es tan chico que no
 * amerita una instrucción propia (zigzag). Los POIs nunca se eliminan,
 * porque son la referencia principal para las instrucciones, incluso si
 * geométricamente casi no generan giro.
 */
function simplifyZigzags(points: RoutePoint[]): RoutePoint[] {
  if (points.length <= 2) return points;

  const result: RoutePoint[] = [points[0]];
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = result[result.length - 1];
    const curr = points[i];
    const next = points[i + 1];
    const angle = turnAngleDegrees(prev, curr, next);
    const isNamed = Boolean(curr.name);

    if (!isNamed && Math.abs(angle) < ZIGZAG_THRESHOLD_DEG) {
      // Punto intermedio sin nombre y giro insignificante: se descarta,
      // el tramo sigue considerándose "recto" entre los puntos vecinos.
      continue;
    }
    result.push(curr);
  }
  result.push(points[points.length - 1]);
  return result;
}

function classifyTurn(angleDeg: number): TurnType | null {
  const abs = Math.abs(angleDeg);
  if (abs < ZIGZAG_THRESHOLD_DEG) return null; // recto, no es un giro real
  const isRight = angleDeg > 0;
  if (abs >= U_TURN_THRESHOLD_DEG) return 'dar_vuelta';
  if (abs >= SLIGHT_TURN_THRESHOLD_DEG) return isRight ? 'girar_derecha' : 'girar_izquierda';
  return isRight ? 'girar_derecha_leve' : 'girar_izquierda_leve';
}

export interface NavigationStepPlain {
  tipo: string;
  distancia?: number;
  referencia?: string;
}

export interface NavigationInstructions {
  poiId: string;
  poiName: string;
  entranceName: string;
  /** Distancia en unidades del plano (píxeles de la imagen subida), no metros reales. */
  unidad: 'plano_px';
  pasos: NavigationStepPlain[];
}

/**
 * Genera las instrucciones de navegación paso a paso, en sentido
 * ENTRADA -> POI destino, a partir del camino más corto ya calculado
 * (`routeNodeToEntrance`, en sentido POI -> entrada) y las aristas del
 * piso (para poder seguir sus waypoints editados a mano).
 *
 * Devuelve `null` si la ruta no tiene al menos dos puntos (no hay nada
 * que narrar).
 */
export function buildNavigationInstructions(
  destinationPoi: Poi,
  entrancePoi: Poi,
  routeNodeToEntrance: Poi[],
  edges: Edge[],
  zones: Zone[] = [],
): NavigationInstructions | null {
  if (routeNodeToEntrance.length < 2) return null;

  const rawPoints = buildRoutePoints(routeNodeToEntrance, edges, zones);
  const points = simplifyZigzags(rawPoints);
  if (points.length < 2) return null;

  const pasos: NavigationStepPlain[] = [];

  for (let i = 0; i < points.length - 1; i += 1) {
    const dist = Math.round(distance(points[i], points[i + 1]) * 10) / 10;
    pasos.push({ tipo: 'avanzar', distancia: dist });

    const nextPoint = points[i + 1];
    const isLastPoint = i + 1 === points.length - 1;
    if (isLastPoint) continue; // el último punto se maneja como "llegada" más abajo

    const angle = turnAngleDegrees(points[i], nextPoint, points[i + 2]);
    const turnType = classifyTurn(angle);

    if (turnType) {
      const step: NavigationStepPlain = { tipo: turnType };
      if (nextPoint.name) step.referencia = nextPoint.name;
      pasos.push(step);
    } else if (nextPoint.name) {
      // Sigue derecho, pero pasa por un POI: se anota como referencia
      // sin cortar el tramo en dos instrucciones de giro.
      pasos.push({ tipo: 'pasar_por', referencia: nextPoint.name });
    }
  }

  pasos.push({ tipo: 'llegada', referencia: destinationPoi.name });

  return {
    poiId: destinationPoi.id,
    poiName: destinationPoi.name,
    entranceName: entrancePoi.name,
    unidad: 'plano_px',
    pasos,
  };
}
