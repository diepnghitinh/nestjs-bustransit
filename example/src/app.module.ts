import { Module } from '@nestjs/common';
import { getEnvFilePath } from '@shared/utils/dotenv';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { env } from 'process';
import { MessagingInfrastructureModule } from '@infrastructure/_core/messaging/messaging.module';
import { OrderProcessingService } from '@infrastructure/messaging/routing-slips/OrderProcessingService';
import { OrderActivityFactory } from '@infrastructure/messaging/routing-slips/OrderActivityFactory';
import { ProcessPaymentActivity } from '@infrastructure/messaging/routing-slips/activities/ProcessPaymentActivity';
import { ReserveInventoryActivity } from '@infrastructure/messaging/routing-slips/activities/ReserveInventoryActivity';
import { SendConfirmationActivity } from '@infrastructure/messaging/routing-slips/activities/SendConfirmationActivity';

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
  providers: [
    AppService,
    // Routing Slip services
    OrderProcessingService,
    OrderActivityFactory,
    ProcessPaymentActivity,
    ReserveInventoryActivity,
    SendConfirmationActivity,
  ],
})
export class AppModule {}
