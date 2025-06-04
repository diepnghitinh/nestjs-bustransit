"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const common_1 = require("@nestjs/common");
const app_module_1 = require("./app.module");
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule);
    await Promise.race([
        app.startAllMicroservices(),
        app.listen(process.env.PORT ?? 3000, async () => {
            common_1.Logger.log(`server is running on ${await app.getUrl()}`, 'Main');
        }),
    ]).catch((err) => console.log(err));
}
bootstrap();
//# sourceMappingURL=main.js.map