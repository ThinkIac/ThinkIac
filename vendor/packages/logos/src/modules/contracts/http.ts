import express from 'express';
import { Container, LogosModule } from '../../kernel/container';
export declare function buildUploadMiddleware(config: any): express.RequestHandler<import("express-serve-static-core").ParamsDictionary, any, any, import("qs").ParsedQs, Record<string, any>>;
/**
 * Ponto de montagem de TODO pacote — um router só, preso ao app uma única vez,
 * durante a fase `wire` (antes de bootstrap() instalar o 404 e o error handler).
 *
 * Sem ele, um pacote criado com o runtime já de pé fazia `app.use()` DEPOIS do
 * 404 catch-all: o Express percorre a stack em ordem, então o 404 respondia
 * antes de a rota nova ser alcançada e o pacote parecia morto até um restart.
 * Montando dentro deste router, a posição na stack do app é fixada no boot e
 * qualquer pacote registrado depois entra antes da cauda.
 */
export declare function getPackageMount(container: Container): any;
export declare function getOrCreateRouter(container: Container, pkgFolder: string): any;
export declare function clearRouter(container: Container, pkgFolder: string): void;
/** True only for an already-mounted route explicitly declared with @public. */
export declare function isRegisteredPublicRoute(container: Container, requestPath: string, requestMethod?: string): boolean;
export declare function mountPackageRoutes(container: Container, pkg: any, targetRouter?: any): Promise<any[]>;
/** Updates the access registry after a staged router swap has become live. */
export declare function replaceRegisteredPublicRoutes(container: Container, pkgFolder: string, routes: any[]): void;
export declare const httpModule: LogosModule;
