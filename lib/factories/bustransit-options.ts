export interface IAdapterConfig {
}

export type BusTransitModuleOptions_Factory = (
    context: any,
    cfg: IAdapterConfig,
) => void;