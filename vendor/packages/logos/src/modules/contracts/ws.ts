import { Container, LogosModule } from '../../kernel/container';
declare const WsHub: new () => any;
export declare function getHub(container: Container): InstanceType<typeof WsHub>;
export declare const wsModule: LogosModule;
export {};
