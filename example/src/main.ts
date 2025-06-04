import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  await Promise.race([
    app.startAllMicroservices(),
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    app.listen(process.env.PORT ?? 3000, async () => {
      Logger.log(`server is running on ${await app.getUrl()}`, 'Main');
    }),
  ]).catch((err) => console.log(err));
}
bootstrap();
