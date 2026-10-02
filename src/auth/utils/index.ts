/**
 * Utility functions for Kong authentication.
 *
 * @packageDocumentation
 */

export { classifyGatewayIdentity } from './classify-gateway-identity';
export type { GatewayIdentity } from './classify-gateway-identity';
export { getRequestPathname } from './get-request-pathname';
export { isInfrastructurePath } from './is-infrastructure-path';
export { parseUserinfoHeader } from './parse-userinfo-header';
export { readHeader } from './read-header';
export { timingSafeStringEqual } from './timing-safe-string-equal';
