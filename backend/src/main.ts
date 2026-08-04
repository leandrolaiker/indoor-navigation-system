import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  const uploadsDir = path.resolve(process.env.UPLOADS_DIR ?? 'uploads');
  const generatedDir = path.resolve(process.env.GENERATED_DIR ?? 'generated');
  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.mkdirSync(generatedDir, { recursive: true });

  app.enableCors({
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  });

  // Los planos subidos y las imágenes de rutas generadas se sirven como
  // archivos estáticos, referenciados por el frontend mediante /uploads/... y /generated/...
  app.useStaticAssets(uploadsDir, { prefix: '/uploads/' });
  // Las imágenes de ruta se regeneran con el mismo nombre de archivo cada
  // vez ("<poiId>.png"), así que deshabilitamos el cache HTTP para que el
  // navegador nunca sirva una versión vieja desde disco/caché intermedio.
  app.useStaticAssets(generatedDir, {
    prefix: '/generated/',
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'no-store, must-revalidate');
    },
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Backend escuchando en http://localhost:${port}`);
}
bootstrap();
