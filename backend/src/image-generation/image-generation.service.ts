import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCanvas, loadImage } from 'canvas';
import * as fs from 'fs';
import * as path from 'path';
import { Edge, Floor, Poi, Zone } from '../maps/schemas/map.schema';
import { findEdgeBetween, shortestPathToEntrance } from './pathfinding.util';
import { buildNavigationInstructions, NavigationInstructions } from './navigation-instructions.util';

@Injectable()
export class ImageGenerationService {
  private readonly logger = new Logger(ImageGenerationService.name);
  private readonly uploadsDir: string;
  private readonly generatedDir: string;

  constructor(private readonly config: ConfigService) {
    this.uploadsDir = path.resolve(this.config.get('UPLOADS_DIR') ?? 'uploads');
    this.generatedDir = path.resolve(this.config.get('GENERATED_DIR') ?? 'generated');
    fs.mkdirSync(this.generatedDir, { recursive: true });
  }

  /**
   * Genera, para cada POI no-entrada de un piso, una imagen del plano con
   * el camino resaltado hasta el nodo central, y las instrucciones de
   * navegación paso a paso (entrada -> POI) en formato JSON. Devuelve dos
   * mapas poiId -> resultado (o null si no se pudo generar/calcular).
   */
  async generateRouteImagesForFloor(
    mapId: string,
    floor: Floor,
  ): Promise<{
    images: Map<string, string | null>;
    instructions: Map<string, NavigationInstructions | null>;
  }> {
    const images = new Map<string, string | null>();
    const instructions = new Map<string, NavigationInstructions | null>();

    if (!floor.planImagePath) {
      this.logger.warn(`Mapa ${mapId}: sin plano cargado, se omite generación de imágenes.`);
      return { images, instructions };
    }

    const planAbsolutePath = path.resolve(this.uploadsDir, path.basename(floor.planImagePath));
    if (!fs.existsSync(planAbsolutePath)) {
      this.logger.error(`No se encontró el archivo de plano: ${planAbsolutePath}`);
      return { images, instructions };
    }

    const entrancePoi = floor.pois.find((p) => p.isEntrance);
    const baseImage = await loadImage(planAbsolutePath);

    const mapOutputDir = path.join(this.generatedDir, mapId);
    fs.mkdirSync(mapOutputDir, { recursive: true });

    for (const poi of floor.pois) {
      if (poi.isEntrance) continue;

      const routePois = shortestPathToEntrance(floor.pois, floor.edges, poi.id);
      if (!routePois || routePois.length < 2) {
        images.set(poi.id, null);
        instructions.set(poi.id, null);
        continue;
      }

      const fileName = `${poi.id}.png`;
      const outputPath = path.join(mapOutputDir, fileName);
      this.drawRouteImage(baseImage, routePois, floor.edges, floor.zones ?? [], outputPath);

      // Se agrega un parámetro de versión (timestamp del archivo recién escrito)
      // para que el frontend pueda invalidar el cache del navegador: el nombre
      // del archivo no cambia entre regeneraciones, así que sin esto el <img>
      // seguiría mostrando la imagen vieja aunque el contenido en disco cambió.
      images.set(poi.id, `${mapId}/${fileName}?v=${Date.now()}`);

      instructions.set(
        poi.id,
        entrancePoi
          ? buildNavigationInstructions(poi, entrancePoi, routePois, floor.edges, floor.zones ?? [])
          : null,
      );
    }

    return { images, instructions };
  }

  private drawRouteImage(
    baseImage: any,
    routePois: Poi[],
    edges: Edge[],
    zones: Zone[],
    outputPath: string,
  ): void {
    const canvas = createCanvas(baseImage.width, baseImage.height);
    const ctx = canvas.getContext('2d');

    // 1. Dibujar el plano de fondo
    ctx.drawImage(baseImage, 0, 0);

    // 1.b Dibujar las zonas (recuadros con nombre) con opacidad baja, antes
    // de la ruta, para que no la tapen. Son solo referencia visual: no
    // afectan el cálculo del camino más corto.
    if (zones.length > 0) {
      ctx.save();
      ctx.fillStyle = 'rgba(124, 58, 237, 0.12)';
      ctx.strokeStyle = 'rgba(124, 58, 237, 0.6)';
      ctx.lineWidth = 1.5;
      ctx.font = `${Math.max(12, baseImage.width * 0.014)}px sans-serif`;
      for (const zone of zones) {
        ctx.fillStyle = 'rgba(124, 58, 237, 0.12)';
        ctx.fillRect(zone.x, zone.y, zone.width, zone.height);
        ctx.strokeRect(zone.x, zone.y, zone.width, zone.height);
        ctx.fillStyle = 'rgba(88, 28, 135, 0.85)';
        ctx.fillText(zone.name, zone.x + 4, zone.y + 14);
      }
      ctx.restore();
    }

    // 2. Dibujar la ruta resaltada, siguiendo los waypoints editados
    //    manualmente por el usuario en cada tramo (en vez de una línea
    //    recta entre POIs consecutivos).
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = Math.max(4, baseImage.width * 0.006);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i < routePois.length - 1; i += 1) {
      const a = routePois[i];
      const b = routePois[i + 1];
      const edge = findEdgeBetween(edges, a.id, b.id);
      const segmentPoints = [{ x: a.x, y: a.y }, ...(edge?.waypoints ?? []), { x: b.x, y: b.y }];
      segmentPoints.forEach((point, index) => {
        if (i === 0 && index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
    }
    ctx.stroke();

    // 3. Marcar los nodos intermedios de la ruta
    routePois.forEach((poi, index) => {
      const isEndpoint = index === 0 || index === routePois.length - 1;
      ctx.beginPath();
      ctx.arc(poi.x, poi.y, isEndpoint ? 9 : 5, 0, Math.PI * 2);
      ctx.fillStyle = isEndpoint ? '#16a34a' : '#2563eb';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    });

    // 4. Destacar el origen (POI) con un color diferente al de la entrada
    const origin = routePois[0];
    ctx.beginPath();
    ctx.arc(origin.x, origin.y, 10, 0, Math.PI * 2);
    ctx.fillStyle = '#dc2626';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    // 5. Etiqueta con el nombre del POI de origen
    ctx.font = `bold ${Math.max(16, baseImage.width * 0.02)}px sans-serif`;
    ctx.fillStyle = '#111827';
    ctx.textBaseline = 'bottom';
    const label = origin.name;
    const metrics = ctx.measureText(label);
    const padding = 6;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(
      origin.x - metrics.width / 2 - padding,
      origin.y - 18 - padding * 2,
      metrics.width + padding * 2,
      18 + padding,
    );
    ctx.fillStyle = '#111827';
    ctx.fillText(label, origin.x - metrics.width / 2, origin.y - 18);

    const buffer = canvas.toBuffer('image/png');
    fs.writeFileSync(outputPath, buffer);
  }

  deleteMapGeneratedImages(mapId: string): void {
    const dir = path.join(this.generatedDir, mapId);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
}
