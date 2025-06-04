import {DynamicModule, Type} from "@nestjs/common";

export interface IBustransitModuleOptions {
    name?: string;
    useClass?: Type<IBustransitModuleOptions>;
    useExisting?: Type<IBustransitModuleOptions>;
    useFactory: (...args: any[]) => {
        [key: string]: any;
    };
    module: DynamicModule,
    inject?: any[];
    isGlobal?: boolean;
}