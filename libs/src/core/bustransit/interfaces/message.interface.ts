interface IMessage<T> extends IMessageContext<T> {
    type: string,
    message: T,
}

interface IErrorMessage {
    headers: any,
    message: string,
    host: any,
    error: any,
}