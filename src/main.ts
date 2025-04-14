import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import {
  BustransitBokerRabbitmqServerStrategy
} from "@core/bustransit/factories/brokers/bustransit-boker.rabbitmq.server-strategy";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.connectMicroservice({
    strategy: new BustransitBokerRabbitmqServerStrategy(),
  });

  await Promise.race([
    app.startAllMicroservices(),
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    app.listen(process.env.PORT ?? 3000, async () => {
      Logger.log(`server is running on ${await app.getUrl()}`, 'Main');
    }),
  ]).catch((err) => console.log(err));
}
bootstrap();
