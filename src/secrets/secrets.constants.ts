/**
 * Key a service reads its own API key by (`secrets.get('API_KEY')`, the
 * AuthGuard's service-key check). The key is stored once per service under
 * `{SERVICE}_API_KEY`, the name its callers read it by.
 */
export const SERVICE_API_KEY_ALIAS = 'API_KEY';

/** Suffix of the stored name: `AUTH_SERVICE_API_KEY` */
export const SERVICE_API_KEY_SUFFIX = '_API_KEY';
