interface ISaga
{
    /// <summary>
    /// Identifies the saga instance uniquely, and is the primary correlation
    /// for the instance. While the setter is not typically called, it is there
    /// to support persistence consistently across implementations.
    /// </summary>
    CorrelationId: string;
}

interface IState {}

interface IEvent<T> {}