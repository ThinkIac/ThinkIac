// Generic execution primitives for the external compatibility adapter.
import * as authority from './authority-context';
import * as context from './context';
import * as debug from './debug-log';
import * as scan from './scan';
import * as isolation from '../core/isolated/bridge';
import { stabilizationPorts } from './stabilization-compat';
import * as conditions from './conditions';
import * as middleware from './middleware';
import * as manifest from './manifest';
import * as performance from './http-performance';
import * as utils from './utils';
import * as stabilization from '../stabilizer/isolation';
export function modulePrimitives() {
  return { authority, context, debug, scan, isolation, lifecycle: stabilizationPorts(), ports: {
    'kernel/authority-context': authority, 'kernel/context': context, 'kernel/debug-log': debug,
    'kernel/scan': scan, 'kernel/conditions': conditions, 'kernel/middleware': middleware,
    'kernel/manifest': manifest, 'kernel/http-performance': performance, 'kernel/utils': utils,
    'core/isolated/bridge': isolation, 'stabilizer/isolation': stabilization,
  } };
}
