export declare const config: {
    readonly env: string;
    readonly isDev: boolean;
    readonly isProd: boolean;
    readonly port: number;
    readonly host: string;
    readonly databaseUrl: string;
    readonly jwtSecret: string;
    readonly jwtExpiresIn: string;
    readonly queueDriver: "pgboss" | "redis";
    readonly redisUrl: string;
    readonly mpesa: {
        readonly env: "sandbox" | "production";
        readonly consumerKey: string;
        readonly consumerSecret: string;
        readonly shortcode: string;
        readonly passkey: string;
        readonly callbackUrl: string;
        readonly webhookKey: string;
    };
    readonly sms: {
        readonly provider: "africastalking" | "twilio" | "infobip";
        readonly apiKey: string;
        readonly senderId: string;
    };
    readonly corsOrigins: string[];
    readonly logLevel: string;
    readonly sentryDsn: string;
};
export type Config = typeof config;
//# sourceMappingURL=config.d.ts.map