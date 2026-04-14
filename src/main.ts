import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');
  app.use(cookieParser());

  app.enableCors({
    origin: 'http://localhost:3000',
    credentials: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
  });

  app.use(helmet());
  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      max: 500, // Increased to avoid 429 errors during development
    }),
  );

  await app.listen(4000);
  console.log(`🚀 Backend running at http://localhost:4000`);
}
bootstrap();
