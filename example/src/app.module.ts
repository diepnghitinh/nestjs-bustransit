import { Module } from '@nestjs/common';
import { getEnvFilePath } from '@shared/utils/dotenv';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { env } from 'process';
import { MessagingInfrastructureModule } from '@infrastructure/_core/messaging/messaging.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: getEnvFilePath(env.NODE_ENV),
      expandVariables: true,
    }),
    MessagingInfrastructureModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
