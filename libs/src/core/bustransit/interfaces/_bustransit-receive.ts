interface IReceiveConfigurator<T> {
    ReceiveEndpoint(queueName: string, e: (e: T) => void): void;
}