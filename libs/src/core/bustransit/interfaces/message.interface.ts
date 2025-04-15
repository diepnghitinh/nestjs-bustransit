interface IMessage<T> {
    "messageId": string,
    "sourceAddress": string,
    "destinationAddress": string, //rabbitmq://localhost/test_message_queue1?bind=true"
    "responseAddress": string,
    "faultAddress": string,
    "messageType": string, //  "urn:message:GettingStarted:MessageABC"
    "message": T,
    "expirationTime": string,
    "sentTime": string,
    "headers": any,
    "host": any
}

interface IErrorMessage {
    headers: any,
    message: string,
    host: any,
}