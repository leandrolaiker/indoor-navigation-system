import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';
import { MapDocument, MapEntity } from './schemas/map.schema';
import { CreateMapDto } from './dto/create-map.dto';
import { SaveGraphDto } from './dto/save-graph.dto';
import { ImageGenerationService } from '../image-generation/image-generation.service';

@Injectable()
export class MapsService {
  private readonly uploadsDir: string;

  constructor(
    @InjectModel(MapEntity.name) private readonly mapModel: Model<MapDocument>,
    private readonly imageGenerationService: ImageGenerationService,
    private readonly config: ConfigService,
  ) {
    this.uploadsDir = path.resolve(this.config.get('UPLOADS_DIR') ?? 'uploads');
  }

  async create(dto: CreateMapDto): Promise<MapDocument> {
    const created = new this.mapModel({
      name: dto.name,
      floors: [{ floorNumber: 0, pois: [], edges: [], zones: [] }],
    });
    return created.save();
  }

  async findAll(): Promise<MapDocument[]> {
    return this.mapModel.find().sort({ updatedAt: -1 }).exec();
  }

  async findOne(id: string): Promise<MapDocument> {
    const map = await this.mapModel.findById(id).exec();
    if (!map) throw new NotFoundException(`Mapa ${id} no encontrado`);
    return map;
  }

  async updateName(id: string, name: string): Promise<MapDocument> {
    const map = await this.findOne(id);
    map.name = name;
    return map.save();
  }

  async remove(id: string): Promise<void> {
    const map = await this.findOne(id);
    const floor = map.floors[0];
    if (floor?.planImagePath) {
      const filePath = path.resolve(this.uploadsDir, path.basename(floor.planImagePath));
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    this.imageGenerationService.deleteMapGeneratedImages(id);
    await this.mapModel.findByIdAndDelete(id).exec();
  }

  async setPlanImage(
    id: string,
    fileName: string,
    width: number,
    height: number,
  ): Promise<MapDocument> {
    const map = await this.findOne(id);
    const floor = map.floors[0];

    // Si ya existía un plano previo, se elimina el archivo anterior.
    if (floor.planImagePath) {
      const previousPath = path.resolve(this.uploadsDir, path.basename(floor.planImagePath));
      if (fs.existsSync(previousPath)) fs.unlinkSync(previousPath);
    }

    floor.planImagePath = fileName;
    floor.planImageWidth = width;
    floor.planImageHeight = height;
    map.markModified('floors');
    return map.save();
  }

  /**
   * Reemplaza el grafo (POIs + aristas) del único piso del mapa y dispara
   * la generación automática de una imagen de ruta por cada POI.
   * Valida que exista exactamente un nodo de entrada principal.
   */
  async saveGraphAndGenerateImages(id: string, dto: SaveGraphDto): Promise<MapDocument> {
    const map = await this.findOne(id);
    const floor = map.floors[0];

    if (!floor.planImagePath) {
      throw new BadRequestException('Debe subir el plano antes de guardar el grafo.');
    }

    const entrances = dto.pois.filter((p) => p.isEntrance);
    if (entrances.length !== 1) {
      throw new BadRequestException(
        'Debe existir exactamente un nodo de entrada principal (isEntrance=true).',
      );
    }

    const poiIds = new Set(dto.pois.map((p) => p.id));
    for (const edge of dto.edges) {
      if (!poiIds.has(edge.fromPoiId) || !poiIds.has(edge.toPoiId)) {
        throw new BadRequestException(
          `La conexión ${edge.id} referencia un POI inexistente.`,
        );
      }
    }

    floor.pois = dto.pois.map((p) => ({
      id: p.id,
      name: p.name,
      x: p.x,
      y: p.y,
      isEntrance: p.isEntrance,
      generatedImagePath:
        floor.pois.find((existing) => existing.id === p.id)?.generatedImagePath ?? null,
      instructions: floor.pois.find((existing) => existing.id === p.id)?.instructions ?? null,
    }));
    floor.edges = dto.edges.map((e) => ({
      id: e.id,
      fromPoiId: e.fromPoiId,
      toPoiId: e.toPoiId,
      waypoints: (e.waypoints ?? []).map((w) => ({ x: w.x, y: w.y })),
    }));
    floor.zones = (dto.zones ?? []).map((z) => ({
      id: z.id,
      name: z.name,
      x: z.x,
      y: z.y,
      width: z.width,
      height: z.height,
    }));

    const { images: generatedImages, instructions: generatedInstructions } =
      await this.imageGenerationService.generateRouteImagesForFloor(id, floor);
    for (const poi of floor.pois) {
      if (generatedImages.has(poi.id)) {
        poi.generatedImagePath = generatedImages.get(poi.id) ?? null;
      }
      if (generatedInstructions.has(poi.id)) {
        const pasos = generatedInstructions.get(poi.id)?.pasos;
        poi.instructions = pasos
          ? pasos.map((p) => ({
              tipo: p.tipo,
              distancia: p.distancia ?? null,
              referencia: p.referencia ?? null,
            }))
          : null;
      }
    }

    map.markModified('floors');
    return map.save();
  }

  /**
   * Devuelve un POI puntual junto con la información necesaria para que un
   * servicio externo (p.ej. integración futura con Ollama) construya
   * instrucciones de navegación: nombre, imagen de ruta generada y datos
   * del nodo de entrada.
   */
  /**
   * Ruta absoluta en disco donde se guardan las imágenes de ruta generadas
   * para este mapa (backend/generated/<mapId>/). Sirve tanto para que el
   * usuario las revise manualmente en el filesystem del servidor, como para
   * que el controller arme un .zip descargable.
   */
  getGeneratedImagesDir(mapId: string): string {
    return path.resolve(
      path.resolve(this.config.get('GENERATED_DIR') ?? 'generated'),
      mapId,
    );
  }

  async getPoiNavigationInfo(mapId: string, poiId: string) {
    const map = await this.findOne(mapId);
    const floor = map.floors[0];
    const poi = floor.pois.find((p) => p.id === poiId);
    if (!poi) throw new NotFoundException(`POI ${poiId} no encontrado`);
    const entrance = floor.pois.find((p) => p.isEntrance) ?? null;

    return {
      mapId,
      poi,
      entrance,
      generatedImageUrl: poi.generatedImagePath ? `/generated/${poi.generatedImagePath}` : null,
      instructions: this.buildInstructionsResponse(poi, entrance),
    };
  }

  /**
   * Devuelve el JSON de instrucciones de navegación paso a paso para un
   * POI puntual (entrada -> POI), pensado para ser consumido tal cual por
   * un servicio externo (ej. un LLM que redacte el texto final).
   */
  async getPoiInstructions(mapId: string, poiId: string) {
    const map = await this.findOne(mapId);
    const floor = map.floors[0];
    const poi = floor.pois.find((p) => p.id === poiId);
    if (!poi) throw new NotFoundException(`POI ${poiId} no encontrado`);
    const entrance = floor.pois.find((p) => p.isEntrance) ?? null;

    const instructions = this.buildInstructionsResponse(poi, entrance);
    if (!instructions) {
      throw new NotFoundException(
        `Todavía no hay instrucciones generadas para el POI ${poiId}. Guardá el grafo primero.`,
      );
    }
    return instructions;
  }

  /**
   * Arma el JSON completo de instrucciones a partir de los pasos ya
   * calculados y persistidos en el POI (`poi.instructions`), agregando el
   * nombre actual del POI/entrada (así nunca queda desactualizado si se
   * renombran después de generar las instrucciones).
   */
  private buildInstructionsResponse(
    poi: { id: string; name: string; instructions: unknown },
    entrance: { name: string } | null,
  ) {
    if (!poi.instructions || !entrance) return null;
    return {
      poiId: poi.id,
      poiName: poi.name,
      entranceName: entrance.name,
      unidad: 'plano_px',
      pasos: poi.instructions,
    };
  }
}
