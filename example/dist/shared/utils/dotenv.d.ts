import { ConfigService } from '@nestjs/config';
export declare const getEnvFilePath: (NODE_ENV: string) => string;
export declare const utilConfigService: ConfigService<Record<string | symbol, unknown>, false>;
