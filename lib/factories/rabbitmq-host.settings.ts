import {IRabbitmqHostSettings} from "../interfaces/rabbitmq-host.settings.interface";

export class RabbitmqHostSettings implements IRabbitmqHostSettings {
    private options = {
        username: '',
        password: '',
    }
    Username(username: string): void {
        this.options.username = username;
    }
    Password(password: string): void {
        this.options.password = password;
    }
    getOptions(): any{
        return this.options;
    }
}
