// src/database/scriba.ts — v1 compatibility re-export.
// Packages that did `require('logos/database/scriba')` keep working.

'use strict';

import { externalApi } from '../kernel/external-modules';
import { getDefaultContainer } from '../kernel/container';
const api = () => externalApi<any>(getDefaultContainer(), 'db');
export const getScriba = () => api().getScriba();
export const getProxy = (tenant: string) => api().getProxy(tenant);
export const addTenant = (value: any) => api().addTenant(value);
export default getScriba;
