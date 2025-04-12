interface IRabbitMqExchangeConfigurator {

    /// <summary>
    /// Specify the queue should be durable (survives broker restart) or in-memory
    /// </summary>
    /// <value>True for a durable queue, False for an in-memory queue</value>
    Durable: boolean;

    /// <summary>
    /// Specify that the queue (and the exchange of the same name) should be created as auto-delete
    /// </summary>
    AutoDelete: boolean;

    /// <summary>
    /// Specify the exchange type for the endpoint
    /// </summary>
    ExchangeType: string;

    /// <summary>
    /// Set an exchange argument passed to the broker on queue declaration
    /// </summary>
    /// <param name="key">The argument key</param>
    /// <param name="value">The argument value</param>
    SetExchangeArgument(key: string, value: any);

}