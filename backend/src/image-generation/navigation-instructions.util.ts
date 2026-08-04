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

/**
 * Distancia mínima (en px del plano) desde el punto (x, y) hasta el borde
 * de la zona. Da 0 si el punto está adentro (ese caso ya lo resuelve
 * `findZoneAt`, con prioridad sobre "cerca de").
 */
function distanceToZoneEdge(zone: Zone, x: number, y: number): number {
  const dx = Math.max(zone.x - x, 0, x - (zone.x + zone.width));
  const dy = Math.max(zone.y - y, 0, y - (zone.y + zone.height));
  return Math.hypot(dx, dy);
}

/**
 * Umbral (en px del plano) por debajo del cual un punto de la ruta que NO
 * está dentro de ninguna zona, pero pasa cerca de una, genera una
 * referencia "pasar cerca de <zona>" en vez de no decir nada. Es un valor
 * fijo en unidades del plano subido (no metros reales), consistente con
 * el resto de las distancias que ya se manejan en píxeles de imagen.
 */
const NEARBY_ZONE_THRESHOLD_PX = 40;

/**
 * Devuelve la zona más CERCANA (no la más chica) a un punto que no está
 * dentro de ninguna zona, siempre que esa distancia sea menor al umbral
 * `NEARBY_ZONE_THRESHOLD_PX`. Se usa como segundo fallback de referencia,
 * de menor prioridad que "estar dentro" (`findZoneAt`): si un punto está
 * cerca de varias zonas a la vez, se elige la que tiene el borde más
 * próximo, no la de menor área, porque "cerca de" es una relación de
 * proximidad, no de contención.
 */
export function findNearbyZoneAt(
  zones: Zone[],
  x: number,
  y: number,
  thresholdPx: number = NEARBY_ZONE_THRESHOLD_PX,
): Zone | undefined {
  let best: Zone | undefined;
  let bestDist = Infinity;
  for (const zone of zones) {
    const dist = distanceToZoneEdge(zone, x, y);
    if (dist > 0 && dist <= thresholdPx && dist < bestDist) {
      bestDist = dist;
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
 * como referencia), un waypoint dentro de una zona (`name` = nombre de la
 * zona, mismo trato que un POI), o un waypoint que no está dentro de
 * ninguna zona pero pasa cerca de una (`nearbyName`, referencia más
 * débil: "pasar cerca de", y sí puede descartarse por zigzag).
 */
interface RoutePoint {
  x: number;
  y: number;
  name?: string;
  nearbyName?: string;
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
 * como `referencia` en las instrucciones). Si no caen dentro de ninguna
 * zona pero pasan cerca de una (ver `findNearbyZoneAt`), se guarda ese
 * nombre en `nearbyName`: tampoco se descarta por zigzag (el caso típico
 * es justamente un tramo recto paralelo a la zona), pero genera un paso
 * distinto (`pasar_cerca_de` en vez de `pasar_por`).
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
        const nearbyZone =
          !zone && zones.length > 0 ? findNearbyZoneAt(zones, wp.x, wp.y) : undefined;
        points.push({ x: wp.x, y: wp.y, name: zone?.name, nearbyName: nearbyZone?.name });
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
 * amerita una instrucción propia (zigzag). Los puntos con `name` (POI o
 * zona que los contiene) o con `nearbyName` (zona cercana) nunca se
 * eliminan, porque son la referencia principal para las instrucciones,
 * incluso si geométricamente casi no generan giro — de hecho, el caso
 * típico de "pasar cerca de" es justamente un tramo recto (ángulo ~0)
 * paralelo a una zona, así que descartarlo por zigzag anularía la
 * referencia en el caso más común.
 */
function simplifyZigzags(points: RoutePoint[]): RoutePoint[] {
  if (points.length <= 2) return points;

  const result: RoutePoint[] = [points[0]];
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = result[result.length - 1];
    const curr = points[i];
    const next = points[i + 1];
    const angle = turnAngleDegrees(prev, curr, next);
    const isReference = Boolean(curr.name) || Boolean(curr.nearbyName);

    if (!isReference && Math.abs(angle) < ZIGZAG_THRESHOLD_DEG) {
      // Punto intermedio sin referencia y giro insignificante: se
      // descarta, el tramo sigue considerándose "recto" entre los puntos
      // vecinos.
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

/**
 * Tipo de referencia geográfica que acompaña a un paso: `pasar_por` cuando
 * el punto cae dentro de un POI o de una zona (ver `findZoneAt`), y
 * `pasar_cerca_de` cuando no entra en ninguna zona pero pasa lo bastante
 * cerca del borde de una como para servir de referencia (ver
 * `findNearbyZoneAt`).
 */
export type ReferenciaTipo = 'pasar_por' | 'pasar_cerca_de';

/**
 * Referencia geográfica de un paso: de qué forma se relaciona la ruta con
 * la zona/POI (`tipo`: se pasa por dentro o solo cerca) y a cuál
 * (`referencia`, el nombre). Es siempre un atributo OPCIONAL de
 * `NavigationStepPlain`, nunca un tipo de paso en sí mismo: el `tipo` del
 * paso describe siempre el movimiento (avanzar, girar, llegar); esta
 * referencia es información adicional sobre ESE movimiento.
 */
export interface NavigationReferencia {
  tipo: ReferenciaTipo;
  referencia: string;
}

/** Tipos de paso: siempre describen un movimiento, nunca una referencia. */
export type MovementType = TurnType | 'avanzar' | 'llegada';

export interface NavigationStepPlain {
  tipo: MovementType;
  distancia?: number;
  referencia?: NavigationReferencia;
}

export interface NavigationInstructions {
  poiId: string;
  poiName: string;
  entranceName: string;
  /** Distancia en unidades del plano (píxeles de la imagen subida), no metros reales. */
  unidad: 'plano_px';
  pasos: NavigationStepPlain[];
  /** Párrafo en lenguaje natural, sin unidades, solo referencias a zonas/POIs. */
  texto: string;
}

const TURN_PHRASES: Record<TurnType, string> = {
  girar_derecha_leve: 'doblá levemente a la derecha',
  girar_derecha: 'girá a la derecha',
  girar_izquierda_leve: 'doblá levemente a la izquierda',
  girar_izquierda: 'girá a la izquierda',
  dar_vuelta: 'date la vuelta',
};

function refPhrase(ref: NavigationReferencia): string {
  return ref.tipo === 'pasar_por' ? `pasando por ${ref.referencia}` : `pasando cerca de ${ref.referencia}`;
}

function joinRefPhrases(refs: NavigationReferencia[]): string {
  if (refs.length === 0) return '';
  if (refs.length === 1) return refPhrase(refs[0]);
  const head = refs.slice(0, -1).map(refPhrase).join(', ');
  return `${head} y ${refPhrase(refs[refs.length - 1])}`;
}

/**
 * Arma el párrafo en lenguaje natural a partir de los `pasos` ya
 * calculados. A diferencia del JSON, acá se combinan en una sola oración
 * el/los avances y el giro que le sigue, y nunca se mencionan distancias:
 * todo se ancla a las zonas/POIs de referencia (o, si un tramo no tiene
 * ninguna referencia cerca, simplemente "seguí derecho").
 */
export function buildNavigationText(
  pasos: NavigationStepPlain[],
  entranceName: string,
  poiName: string,
): string {
  const sentences: string[] = [];
  let i = 0;

  while (i < pasos.length && pasos[i].tipo !== 'llegada') {
    const avanzarRefs: NavigationReferencia[] = [];
    while (i < pasos.length && pasos[i].tipo === 'avanzar') {
      if (pasos[i].referencia) avanzarRefs.push(pasos[i].referencia!);
      i += 1;
    }

    let turnStep: NavigationStepPlain | undefined;
    if (i < pasos.length && pasos[i].tipo !== 'llegada') {
      turnStep = pasos[i];
      i += 1;
    }

    let sentence = 'seguí derecho';
    if (avanzarRefs.length > 0) sentence += `, ${joinRefPhrases(avanzarRefs)}`;
    if (turnStep) {
      sentence += ` y ${TURN_PHRASES[turnStep.tipo as TurnType]}`;
      if (turnStep.referencia) sentence += `, en ${turnStep.referencia.referencia}`;
    }
    sentences.push(sentence);
  }

  const llegadaStep = pasos[pasos.length - 1];
  const destino = llegadaStep?.referencia?.referencia ?? poiName;
  sentences.push(`llegás a ${destino}`);

  // La primera oración continúa la frase "Desde <entrada>, ..." en
  // minúscula; el resto son oraciones nuevas y van con mayúscula inicial.
  const resto = sentences
    .slice(1)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('. ');

  return `Desde ${entranceName}, ${sentences[0]}.${resto ? ` ${resto}.` : ''}`;
}

/**
 * Forma mínima que necesita `hashPasos`, deliberadamente más laxa que
 * `NavigationStepPlain`: así acepta tanto los pasos "planos" recién
 * calculados como los ya persistidos en el documento de Mongoose
 * (`NavigationStep` en `map.schema.ts`), donde `distancia`/`referencia`
 * son `... | null` en vez de opcionales.
 */
export interface NavigationStepLike {
  tipo: string;
  distancia?: number | null;
  referencia?: { tipo: string; referencia: string } | null;
}

/**
 * Hash simple (no criptográfico) de los `pasos` de una ruta, usado
 * únicamente para detectar si un texto de instrucciones editado a mano
 * quedó desactualizado (la ruta cambió después de que el usuario escribió
 * el texto manual). No hace falta que sea seguro, solo estable y sensible
 * a cualquier cambio relevante de la ruta.
 */
export function hashPasos(pasos: NavigationStepLike[]): string {
  const serialized = JSON.stringify(pasos);
  let hash = 0;
  for (let i = 0; i < serialized.length; i += 1) {
    hash = (hash * 31 + serialized.charCodeAt(i)) | 0;
  }
  return hash.toString(16);
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
    const avanzarStep: NavigationStepPlain = { tipo: 'avanzar', distancia: dist };

    const nextPoint = points[i + 1];
    const isLastPoint = i + 1 === points.length - 1;
    if (isLastPoint) {
      pasos.push(avanzarStep);
      continue; // el último punto se maneja como "llegada" más abajo
    }

    const angle = turnAngleDegrees(points[i], nextPoint, points[i + 2]);
    const turnType = classifyTurn(angle);

    if (turnType) {
      if (nextPoint.name) {
        // El giro ocurre justo en un POI o dentro de una zona: la
        // referencia se adjunta al propio giro (equivalente a "pasar
        // por" + girar en el mismo punto). El avance previo no lleva
        // referencia.
        pasos.push(avanzarStep);
        pasos.push({ tipo: turnType, referencia: { tipo: 'pasar_por', referencia: nextPoint.name } });
      } else if (nextPoint.nearbyName) {
        // El giro ocurre cerca de una zona, pero sin entrar en ella: la
        // referencia "pasar cerca de" se adjunta al AVANCE (nunca al
        // giro), para que el `tipo` del giro siga describiendo solo
        // movimiento y la referencia distinga sin ambigüedad "dentro"
        // (referencia en el giro) de "cerca" (referencia en el avance).
        pasos.push({
          ...avanzarStep,
          referencia: { tipo: 'pasar_cerca_de', referencia: nextPoint.nearbyName },
        });
        pasos.push({ tipo: turnType });
      } else {
        pasos.push(avanzarStep);
        pasos.push({ tipo: turnType });
      }
    } else if (nextPoint.name) {
      // Sigue derecho, pero pasa por un POI o por dentro de una zona: se
      // anota como referencia del propio avance, sin instrucción de giro.
      pasos.push({ ...avanzarStep, referencia: { tipo: 'pasar_por', referencia: nextPoint.name } });
    } else if (nextPoint.nearbyName) {
      // Sigue derecho y no pasa por dentro de ninguna zona, pero el
      // trazado corre lo bastante cerca del borde de una como para que
      // sirva de referencia (ej. un pasillo paralelo a una sala).
      pasos.push({
        ...avanzarStep,
        referencia: { tipo: 'pasar_cerca_de', referencia: nextPoint.nearbyName },
      });
    } else {
      pasos.push(avanzarStep);
    }
  }

  pasos.push({ tipo: 'llegada', referencia: { tipo: 'pasar_por', referencia: destinationPoi.name } });

  return {
    poiId: destinationPoi.id,
    poiName: destinationPoi.name,
    entranceName: entrancePoi.name,
    unidad: 'plano_px',
    pasos,
    texto: buildNavigationText(pasos, entrancePoi.name, destinationPoi.name),
  };
}
