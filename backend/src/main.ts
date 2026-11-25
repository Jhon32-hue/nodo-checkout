import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { configureApplication } from './app.setup';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { abortOnError: false });
  try {
    configureApplication(app);
    await app.listen(app.get(ConfigService).getOrThrow<number>('PORT'));
  } catch (error) {
    await app.close();
    throw error;
  }
}
bootstrap().catch(() => {
  Logger.error(
    'Application startup failed. Check configuration and service availability.',
    'Bootstrap',
  );
  process.exitCode = 1;
});
