import { Module } from '@nestjs/common';
import { ImageGenerationService } from './image-generation.service';

@Module({
  providers: [ImageGenerationService],
  exports: [ImageGenerationService],
})
export class ImageGenerationModule {}
