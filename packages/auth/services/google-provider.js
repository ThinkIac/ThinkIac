import { createGoogleAuth } from './google-auth.js';
import { ensureEntitlement, isRetiredLocalAccount } from './account-policy.js';
export const googleAuth = createGoogleAuth({ ensureEntitlement, isRetiredLocalAccount });
