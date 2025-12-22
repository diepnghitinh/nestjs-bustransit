// IMPORTANT: Import routing slip config FIRST to set the mode before BusTransit loads
import './routing-slip.config';

import { Module } from '@nestjs/common';
import { getEnvFilePath } from '@shared/utils/dotenv';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { env } from 'process';
import { MessagingInfrastructureModule } from '@infrastructure/_core/messaging/messaging.module';
import { OrderProcessingService } from '@infrastructure/messaging/routing-slips/OrderProcessingService';
import { ProcessPaymentActivity } from '@infrastructure/messaging/routing-slips/activities/ProcessPaymentActivity';
import { ReserveInventoryActivity } from '@infrastructure/messaging/routing-slips/activities/ReserveInventoryActivity';
import { SendConfirmationActivity } from '@infrastructure/messaging/routing-slips/activities/SendConfirmationActivity';
import { ValidateInventoryActivity } from '@infrastructure/messaging/routing-slips/activities/ValidateInventoryActivity';
import { RoutingSlipModule } from 'nestjs-bustransit';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: getEnvFilePath(env.NODE_ENV),
      expandVariables: true,
    }),

    // Configure Routing Slips
    // NOTE: Execution mode is set in routing-slip.config.ts (imported at the top)
    // RoutingSlipModule.forRoot() automatically reads the mode from the registry
    RoutingSlipModule.forRoot({
      enableEventSubscribers: true
    }),

    MessagingInfrastructureModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Routing Slip services and activities
    OrderProcessingService,
    // Activities are now auto-discovered via @RoutingSlipActivity decorator
    ProcessPaymentActivity,
    ReserveInventoryActivity,
    SendConfirmationActivity,
    ValidateInventoryActivity,
  ],
})
export class AppModule {}
