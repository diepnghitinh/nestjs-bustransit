import { config } from 'dotenv';
import { resolve } from 'path';
import { cwd, env } from 'process';
import * as dotenvExpand from 'dotenv-expand';
import { ConfigService } from '@nestjs/config';

export const getEnvFilePath = (NODE_ENV: string) => {
    const joinPath = (fileName) => resolve(cwd(), 'config', fileName);
    switch (NODE_ENV) {
        case 'development':
        case 'dev':
            return joinPath('.dev.env');
        case 'local':
            return joinPath('.local.env');
        default:
            return joinPath('.prod.env');
    }
};

console.log('getEnvFilePath:', getEnvFilePath(env['NODE' + '_ENV']));

dotenvExpand.expand(config({ path: getEnvFilePath(env['NODE' + '_ENV']) }));

export const utilConfigService = new ConfigService();
