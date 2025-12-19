export interface ISaga
{
    /// <summary>
    /// Identifies the saga instance uniquely, and is the primary correlation
    /// for the instance. While the setter is not typically called, it is there
    /// to support persistence consistently across implementations.
    /// </summary>
    CorrelationId: string;
}

export interface IState {
}

export interface IEvent<T> {
    Name: string;
    Value: T;
}