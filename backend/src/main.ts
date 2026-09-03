import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';

/**
 * Parse the CORS_ORIGINS env var (comma-separated list) into the option shape
 * the `cors` package expects.
 *
 * The `cors` package only treats the exact string '*' as a wildcard; passing
 * ['*'] (an array) turns it into an exact-match allowlist and the
 * Access-Control-Allow-Origin header is never emitted — which makes browsers
 * block cross-origin API calls ("Load failed" / "Failed to fetch").
 *
 * - '*'           -> '*' (wildcard, reflects any origin)
 * - 'https://a.com,https://b.com' -> ['https://a.com', 'https://b.com']
 * - 'https://a.com' -> 'https://a.com' (single origin)
 */
function parseCorsOrigins(raw: string | undefined): string | string[] {
  const origins = (raw ?? '*')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (origins.length === 0) return '*';
  if (origins.includes('*')) return '*';
  return origins.length === 1 ? origins[0] : origins;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  app.use(helmet());
  app.enableCors({
    origin: parseCorsOrigins(config.get<string>('CORS_ORIGINS', '*')),
    credentials: true,
  });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('VTU Platform API')
    .setDescription(
      'Virtual Top-Up & bills payment API — Airtime, Data, Cable, Electricity, WAEC, Bulk SMS',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  const port = config.get<number>('PORT', 5000);
  await app.listen(port);
  logger.log(`API running on http://localhost:${port}/api`);
  logger.log(`Swagger docs on http://localhost:${port}/api/docs`);
}
bootstrap();