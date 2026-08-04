import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { MapsModule } from './maps/maps.module';
import { ImageGenerationModule } from './image-generation/image-generation.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('MONGODB_URI') ?? 'mongodb://localhost:27017/interior-maps',
      }),
      inject: [ConfigService],
    }),
    MapsModule,
    ImageGenerationModule,
  ],
})
export class AppModule {}
