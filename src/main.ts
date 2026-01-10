import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Security headers
  app.use(helmet());

  // Rate limiting
  app.use(
    rateLimit({
      windowMs: 60 * 1000, // 1 minute
      max: 50, // max requests per minute
    }),
  );

  // Enable CORS
  app.enableCors({
    origin: ['http://localhost:3000'], // frontend URL
    credentials: true,
  });

  // Global validation for DTOs
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
  );

  await app.listen(3000);
  console.log(`Server running on http://localhost:3000`);
}

bootstrap();
