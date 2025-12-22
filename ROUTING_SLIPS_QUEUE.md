In MassTransit, queues for routing slip activities are typically created automatically by the framework when you configure the receive endpoints for your activities. You do not manually create the queues in the broker for each activity in most standard setups. 
MassTransit follows a convention-based approach where each activity has its own dedicated _execute and _compensate queues. 
How Queues are Created
Define an Activity: You create classes that implement IActivity<TArguments, TLog>.
Configure Receive Endpoints: In your application's startup or configuration code (e.g., in Program.cs), you use methods like ConfigureEndpoints or ReceiveEndpoint to register your activities.
csharp
services.AddMassTransit(x =>
{
    // ... other configurations
    x.AddActivity<ReserveInventoryActivity, ReserveInventoryArguments, ReserveInventoryLog>();

    x.UsingRabbitMq((context, cfg) =>
    {
        cfg.Host("localhost", "/", h => {
            h.Username("guest");
            h.Password("guest");
        });

        // This automatically configures receive endpoints (and thus queues) 
        // for all registered consumers, sagas, and activities.
        cfg.ConfigureEndpoints(context); 
    });
});
Automatic Provisioning: When the bus starts, MassTransit connects to the message broker (like RabbitMQ or Azure Service Bus) and ensures the necessary queues and exchange bindings are provisioned based on the defined activities and their names. For an activity named ReserveInventoryActivity, MassTransit will create queues such as reserve-inventory_execute and reserve-inventory_compensate. 
Key Points
Convention over Configuration: MassTransit's strength is automatically managing the plumbing and topology. This ensures activities are isolated and can be configured independently for retries and concurrency.
No Manual Queue Creation: You generally should not need to use broker-specific tools to manually create these queues. MassTransit handles this for you.
Execution: When a routing slip is built and executed using the Execute extension method on IBus, MassTransit sends the message to the appropriate activity's _execute queue. 
For more in-depth documentation, you can refer to the official MassTransit website. 