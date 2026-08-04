/** 'pasar_por' = la ruta pasa por dentro de la zona/POI; 'pasar_cerca_de' = pasa cerca de su borde, sin entrar. */
export type ReferenciaTipo = 'pasar_por' | 'pasar_cerca_de';

/** Referencia geográfica opcional de un paso: a qué zona/POI corresponde y de qué forma se relaciona la ruta con ella. */
export interface NavigationReferencia {
  tipo: ReferenciaTipo;
  referencia: string;
}

export interface NavigationStep {
  /** Describe únicamente el movimiento del paso (avanzar, girar, llegar). */
  tipo: string;
  distancia?: number;
  referencia?: NavigationReferencia;
}

export interface Poi {
  id: string;
  name: string;
  x: number;
  y: number;
  isEntrance: boolean;
  generatedImagePath: string | null;
  /** Instrucciones de navegación paso a paso (entrada -> este POI), o null si aún no se generaron. */
  instructions: NavigationStep[] | null;
}

export interface Waypoint {
  x: number;
  y: number;
}

export interface Edge {
  id: string;
  fromPoiId: string;
  toPoiId: string;
  /** Puntos intermedios editables (origen -> destino) para acoplar el camino al plano real. */
  waypoints: Waypoint[];
}

/**
 * Zona: recuadro con nombre (rectángulo alineado a los ejes, sin rotación)
 * que sirve como referencia adicional para las instrucciones de
 * navegación (ej. "Salón Principal", "Baño"). Se define por su esquina
 * superior izquierda (x, y) y su ancho/alto. Si dos zonas se solapan,
 * la más chica por área es la que se usa como referencia.
 */
export interface Zone {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Floor {
  floorNumber: number;
  planImagePath: string | null;
  planImageWidth: number;
  planImageHeight: number;
  pois: Poi[];
  edges: Edge[];
  zones: Zone[];
}

export interface MapEntity {
  _id: string;
  name: string;
  floors: Floor[];
  createdAt?: string;
  updatedAt?: string;
}

export type EditorMode = 'move' | 'entrance' | 'poi' | 'connect' | 'delete' | 'zone';
