import type { Container } from '../../kernel/container';
/** One lifecycle operation per package. Nested staging runs inside its caller's lock. */
export declare function packageOperation<T>(container: Container, folder: string, operation: () => Promise<T>): Promise<T>;
