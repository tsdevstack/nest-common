interface AxiosRequestLike {
  headers?: object;
}

/** The part of a generated client (swagger-typescript-api) this uses */
export interface AxiosInstanceClient {
  instance: {
    interceptors: {
      request: {
        use(onFulfilled: <T extends AxiosRequestLike>(config: T) => T): unknown;
      };
    };
  };
}

/**
 * Whether a client exposes its axios instance, as the generated service
 * clients do (`instance`). An axios instance is a function with properties.
 */
export function hasAxiosInstance(
  client: unknown,
): client is AxiosInstanceClient {
  if (typeof client !== 'object' || client === null) {
    return false;
  }
  const instance: unknown = Reflect.get(client, 'instance');
  if (
    (typeof instance !== 'object' && typeof instance !== 'function') ||
    instance === null
  ) {
    return false;
  }
  const interceptors: unknown = Reflect.get(instance, 'interceptors');
  if (typeof interceptors !== 'object' || interceptors === null) {
    return false;
  }
  const request: unknown = Reflect.get(interceptors, 'request');
  return (
    typeof request === 'object' &&
    request !== null &&
    typeof Reflect.get(request, 'use') === 'function'
  );
}
