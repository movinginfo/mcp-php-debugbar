export declare const config: {
    readonly debugbar: {
        readonly baseUrl: string;
        readonly openHandlerPath: string;
        readonly type: "laravel" | "php" | "auto";
        readonly timeout: number;
    };
    readonly chrome: {
        readonly host: string;
        readonly port: number;
        readonly autoConnect: boolean;
    };
    readonly server: {
        readonly maxRequests: number;
        readonly logLevel: string;
    };
    /** Absolute path to the PHP project root. Used to read source files. */
    readonly projectRoot: string;
};
export type Config = typeof config;
//# sourceMappingURL=config.d.ts.map