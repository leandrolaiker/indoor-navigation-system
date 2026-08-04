import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MapsController } from './maps.controller';
import { MapsService } from './maps.service';
import { MapEntity, MapSchema } from './schemas/map.schema';
import { ImageGenerationModule } from '../image-generation/image-generation.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: MapEntity.name, schema: MapSchema }]),
    ImageGenerationModule,
  ],
  controllers: [MapsController],
  providers: [MapsService],
})
export class MapsModule {}
