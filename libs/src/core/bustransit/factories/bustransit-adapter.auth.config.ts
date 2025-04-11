export class BusTransitAdapterAuthConfig 
{
    private options = {
        username: '',
        password: '',
    }
    Username(username: string): void
    {
        this.options.username = username;
    }
    Password(password: string): void
    {
        this.options.password = password;
    }
    public getOptions() {
        return this.options;
    }
}