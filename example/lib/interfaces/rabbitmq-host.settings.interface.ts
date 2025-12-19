export interface IRabbitmqHostSettings {
    Username(username: string): void;
    Password(password: string): void;
    getOptions(): any;
}
