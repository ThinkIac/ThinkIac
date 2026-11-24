export interface Condition {
    only?: string[];
    never?: string[];
    /** v1 leftover — treated as `only`. */
    when?: string[];
}
export declare function resolveConditions(condition?: Condition, context?: Record<string, any>): Promise<boolean>;
