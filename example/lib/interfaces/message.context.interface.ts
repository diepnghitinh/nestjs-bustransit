export interface IMessageContext<T> {
    "messageId": string,
    "sourceAddress": string,
    "destinationAddress": string,
    "messageType": string,
    "expirationTime": string,
    "sentTime": string,
    "headers": any,
}