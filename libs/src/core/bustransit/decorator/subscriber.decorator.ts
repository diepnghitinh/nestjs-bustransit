import 'reflect-metadata';
import {
        applyDecorators,
        CallHandler,
        ExecutionContext,
        Global,
        HttpException,
        Inject,
        Logger, mixin,
        NestInterceptor,
        UseInterceptors,
} from '@nestjs/common';
import {EventPattern} from "@nestjs/microservices";
import { catchError, map, mergeMap, Observable, retryWhen, tap, throwError, timer } from 'rxjs';

export const RabbitSubscribe = (consumer) =>
        applyDecorators(EventPattern(consumer.name, UseInterceptors(HandleMessageMixin( consumer.name ))));

function HandleMessageMixin(consumerName: string) {

        @Global()
        class HandleMessageInterceptor implements NestInterceptor {
                private readonly logger = new Logger(RabbitSubscribe.name);

                public async intercept(context: ExecutionContext, next: CallHandler) {
                        const ctx = context.getArgByIndex(1);
                        const start = performance.now();

                        return next.handle().pipe(
                            tap(() => this.logger.log(`Start subscribe ${consumerName}`)),
                            map((data) => {
                                    return data;
                            }),
                            catchError(async (error: HttpException) => {
                            }),
                            tap(() =>
                                this.logger.log(
                                    `Complete consumer message ${consumerName} after... ${performance.now() - start}ms`,
                                ),
                            ),
                        );
                }

        }

        return mixin(HandleMessageInterceptor);
}