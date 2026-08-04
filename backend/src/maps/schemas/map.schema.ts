import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

/**
 * Referencia geográfica de un paso de navegación: `tipo` indica si la ruta
 * pasa por dentro de la zona/POI ('pasar_por') o solo cerca de su borde
 * ('pasar_cerca_de'); `referencia` es el nombre de esa zona/POI. Nunca
 * define por sí sola el movimiento del paso (eso lo hace `NavigationStep.tipo`).
 */
@Schema({ _id: false })
export class NavigationReferencia {
  @Prop({ required: true })
  tipo: string;

  @Prop({ required: true })
  referencia: string;
}
export const NavigationReferenciaSchema = SchemaFactory.createForClass(NavigationReferencia);

/**
 * Un paso de la instrucción de navegación paso a paso, generado
 * automáticamente a partir de la geometría de la ruta (entrada -> POI).
 * `tipo` define únicamente el movimiento ('avanzar', un giro, o 'llegada');
 * `distancia` (en unidades del plano/imagen, no metros reales) solo aplica a
 * 'avanzar'; `referencia` es un objeto opcional con la zona/POI de
 * referencia para ese movimiento (ver `NavigationReferencia`), cuando
 * corresponde.
 */
@Schema({ _id: false })
export class NavigationStep {
  @Prop({ required: true })
  tipo: string;

  @Prop({ type: Number, default: null })
  distancia: number | null;

  @Prop({ type: NavigationReferenciaSchema, default: null })
  referencia: NavigationReferencia | null;
}
export const NavigationStepSchema = SchemaFactory.createForClass(NavigationStep);

/**
 * Un POI (Point of Interest) es un nodo del grafo de navegación.
 * `isEntrance` marca el nodo central (entrada principal). Solo puede
 * existir un POI con isEntrance=true por piso.
 */
@Schema({ _id: false })
export class Poi {
  @Prop({ required: true })
  id: string;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  x: number;

  @Prop({ required: true })
  y: number;

  @Prop({ default: false })
  isEntrance: boolean;

  // Ruta relativa (servida como estático) a la imagen generada que
  // muestra el camino entre este POI y el nodo central.
  @Prop({ type: String, default: null })
  generatedImagePath: string | null;

  // Instrucciones de navegación paso a paso (entrada -> este POI),
  // generadas automáticamente junto con la imagen de ruta.
  @Prop({ type: [NavigationStepSchema], default: null })
  instructions: NavigationStep[] | null;

  // Párrafo en lenguaje natural generado automáticamente a partir de
  // `instructions`. Se recalcula siempre, incluso si el POI está en modo
  // manual (para poder precargarlo al editar y para detectar si el texto
  // manual quedó desactualizado).
  @Prop({ type: String, default: null })
  textoGenerado: string | null;

  // 'auto' = se expone `textoGenerado`; 'manual' = se expone
  // `manualInstructions` (el usuario lo editó a mano).
  @Prop({ type: String, default: 'auto' })
  instructionsMode: 'auto' | 'manual';

  // Texto editado a mano por el usuario. Vaciarlo/borrarlo vuelve el POI a
  // modo 'auto' (ver MapsService.updatePoiInstructions).
  @Prop({ type: String, default: null })
  manualInstructions: string | null;

  // Hash de `instructions` (ver `hashPasos`) tomado en el momento en que se
  // guardó el texto manual. Si al regenerar la ruta el hash actual difiere,
  // el texto manual quedó desactualizado (se informa, no se sobrescribe).
  @Prop({ type: String, default: null })
  manualInstructionsHash: string | null;
}
export const PoiSchema = SchemaFactory.createForClass(Poi);

/**
 * Un punto intermedio (waypoint) de una arista. Permite que el camino entre
 * dos POIs no sea una línea recta, para poder acoplarlo manualmente a
 * pasillos/curvas reales del plano.
 */
@Schema({ _id: false })
export class Waypoint {
  @Prop({ required: true })
  x: number;

  @Prop({ required: true })
  y: number;
}
export const WaypointSchema = SchemaFactory.createForClass(Waypoint);

/**
 * Una arista no dirigida entre dos POIs, creada gráficamente por el usuario.
 * `waypoints` es la lista ordenada (origen -> destino) de puntos
 * intermedios editables que definen el trazado real del camino.
 */
@Schema({ _id: false })
export class Edge {
  @Prop({ required: true })
  id: string;

  @Prop({ required: true })
  fromPoiId: string;

  @Prop({ required: true })
  toPoiId: string;

  @Prop({ type: [WaypointSchema], default: [] })
  waypoints: Waypoint[];
}
export const EdgeSchema = SchemaFactory.createForClass(Edge);

/**
 * Una zona es un recuadro con nombre (rectángulo alineado a los ejes, sin
 * rotación) que sirve como segunda fuente de referencias para las
 * instrucciones de navegación, además de los POIs puntuales (ej. "Salón
 * Principal", "Baño"). Se define por su esquina superior izquierda
 * (x, y) y su ancho/alto. Si dos zonas se solapan en un punto, la más
 * chica por área "gana" (ver `findZoneAt` en
 * `navigation-instructions.util.ts`).
 */
@Schema({ _id: false })
export class Zone {
  @Prop({ required: true })
  id: string;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  x: number;

  @Prop({ required: true })
  y: number;

  @Prop({ required: true })
  width: number;

  @Prop({ required: true })
  height: number;
}
export const ZoneSchema = SchemaFactory.createForClass(Zone);

/**
 * Un piso contiene el plano (imagen de fondo) y el grafo de navegación
 * (POIs + aristas + zonas). El MVP solo utiliza un piso (floorNumber = 0),
 * pero el modelo ya soporta un arreglo de pisos para futuras versiones.
 */
@Schema({ _id: false })
export class Floor {
  @Prop({ required: true, default: 0 })
  floorNumber: number;

  @Prop({ type: String, default: null })
  planImagePath: string | null;

  @Prop({ default: 0 })
  planImageWidth: number;

  @Prop({ default: 0 })
  planImageHeight: number;

  @Prop({ type: [PoiSchema], default: [] })
  pois: Poi[];

  @Prop({ type: [EdgeSchema], default: [] })
  edges: Edge[];

  @Prop({ type: [ZoneSchema], default: [] })
  zones: Zone[];
}
export const FloorSchema = SchemaFactory.createForClass(Floor);

export type MapDocument = MapEntity & Document;

@Schema({ timestamps: true, collection: 'maps' })
export class MapEntity {
  _id: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ type: [FloorSchema], default: () => [{ floorNumber: 0, pois: [], edges: [], zones: [] }] })
  floors: Floor[];

  createdAt?: Date;
  updatedAt?: Date;
}

export const MapSchema = SchemaFactory.createForClass(MapEntity);
