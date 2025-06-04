"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.utilConfigService = exports.getEnvFilePath = void 0;
const dotenv_1 = require("dotenv");
const path_1 = require("path");
const process_1 = require("process");
const dotenvExpand = require("dotenv-expand");
const config_1 = require("@nestjs/config");
const getEnvFilePath = (NODE_ENV) => {
    const joinPath = (fileName) => (0, path_1.resolve)((0, process_1.cwd)(), 'config', fileName);
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
exports.getEnvFilePath = getEnvFilePath;
console.log('getEnvFilePath:', (0, exports.getEnvFilePath)(process_1.env['NODE' + '_ENV']));
dotenvExpand.expand((0, dotenv_1.config)({ path: (0, exports.getEnvFilePath)(process_1.env['NODE' + '_ENV']) }));
exports.utilConfigService = new config_1.ConfigService();
//# sourceMappingURL=dotenv.js.map