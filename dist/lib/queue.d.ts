import PgBoss from 'pg-boss';
declare class Queue {
    private boss;
    constructor();
    start(): Promise<void>;
    stop(): Promise<void>;
    get instance(): PgBoss;
}
export declare const queue: Queue;
export {};
//# sourceMappingURL=queue.d.ts.map