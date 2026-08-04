import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import * as fs from 'fs';
import archiver from 'archiver';
import { v4 as uuid } from 'uuid';
import { loadImage } from 'canvas';
import { Response } from 'express';
import { MapsService } from './maps.service';
import { CreateMapDto } from './dto/create-map.dto';
import { SaveGraphDto } from './dto/save-graph.dto';
import { UpdatePoiInstructionsDto } from './dto/update-poi-instructions.dto';

const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg'];

@Controller('maps')
export class MapsController {
  constructor(private readonly mapsService: MapsService) {}

  @Post()
  create(@Body() dto: CreateMapDto) {
    return this.mapsService.create(dto);
  }

  @Get()
  findAll() {
    return this.mapsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.mapsService.findOne(id);
  }

  @Put(':id')
  updateName(@Param('id') id: string, @Body('name') name: string) {
    if (!name || !name.trim()) {
      throw new BadRequestException('El nombre no puede estar vacío.');
    }
    return this.mapsService.updateName(id, name.trim());
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.mapsService.remove(id);
  }

  @Post(':id/plan')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: process.env.UPLOADS_DIR ?? 'uploads',
        filename: (_req, file, callback) => {
          const uniqueName = `${uuid()}${extname(file.originalname).toLowerCase()}`;
          callback(null, uniqueName);
        },
      }),
      fileFilter: (_req, file, callback) => {
        if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
          callback(new BadRequestException('Formato no soportado. Use PNG o JPG/JPEG.'), false);
          return;
        }
        callback(null, true);
      },
      limits: { fileSize: 15 * 1024 * 1024 },
    }),
  )
  async uploadPlan(@Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No se recibió ningún archivo.');
    const image = await loadImage(file.path);
    return this.mapsService.setPlanImage(id, file.filename, image.width, image.height);
  }

  @Post(':id/save')
  saveGraph(@Param('id') id: string, @Body() dto: SaveGraphDto) {
    return this.mapsService.saveGraphAndGenerateImages(id, dto);
  }

  @Get(':id/pois/:poiId')
  getPoiInfo(@Param('id') id: string, @Param('poiId') poiId: string) {
    return this.mapsService.getPoiNavigationInfo(id, poiId);
  }

  /**
   * JSON de instrucciones de navegación paso a paso (entrada -> POI),
   * listo para consumir desde un servicio externo (ej. un LLM que arme
   * el texto final en lenguaje natural).
   */
  @Get(':id/pois/:poiId/instructions')
  getPoiInstructions(@Param('id') id: string, @Param('poiId') poiId: string) {
    return this.mapsService.getPoiInstructions(id, poiId);
  }

  /**
   * Guarda (o borra, si `manualInstructions` viene vacío/ausente) el texto
   * de instrucciones editado a mano para un POI. Vaciarlo hace que el POI
   * vuelva a modo 'auto' automáticamente. Devuelve la respuesta de
   * instrucciones ya actualizada, lista para que el frontend la pinte.
   */
  @Put(':id/pois/:poiId/instructions')
  async updatePoiInstructions(
    @Param('id') id: string,
    @Param('poiId') poiId: string,
    @Body() dto: UpdatePoiInstructionsDto,
  ) {
    await this.mapsService.updatePoiInstructions(id, poiId, dto.manualInstructions ?? null);
    return this.mapsService.getPoiInstructions(id, poiId);
  }

  /**
   * Descarga un .zip con todas las imágenes de ruta generadas para el mapa,
   * tal como quedaron guardadas en backend/generated/<mapId>/ en el disco
   * del servidor. Útil para revisarlas o archivarlas fuera de la app.
   */
  @Get(':id/generated/download')
  async downloadGeneratedImages(@Param('id') id: string, @Res() res: Response) {
    const map = await this.mapsService.findOne(id);
    const dir = this.mapsService.getGeneratedImagesDir(id);

    if (!fs.existsSync(dir) || fs.readdirSync(dir).length === 0) {
      throw new NotFoundException('Todavía no se generó ninguna imagen de ruta para este mapa.');
    }

    const safeName = map.name.replace(/[^a-z0-9-_]+/gi, '_');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="rutas-${safeName}.zip"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err: Error) => {
      throw err;
    });
    archive.pipe(res);
    archive.directory(dir, false);
    await archive.finalize();
  }
}
