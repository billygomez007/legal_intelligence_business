import { createServer as createNodeServer, type Server } from 'node:http';

import { routeRequest, type ApiRouterDependencies } from './http/router.js';

export function createLawAfriqueApiServer(dependencies: ApiRouterDependencies): Server {
  return createNodeServer((request, response) => {
    void routeRequest(dependencies, request, response).catch(() => {
      /**
       * Final fail-closed boundary.
       *
       * Never expose raw exception text or stack traces over HTTP.
       */
      if (!response.headersSent) {
        response.statusCode = 500;

        response.setHeader('content-type', 'application/json; charset=utf-8');

        response.setHeader('cache-control', 'no-store');
      }

      if (!response.writableEnded) {
        response.end(
          JSON.stringify({
            error: {
              code: 'internal_error',
            },
          }),
        );
      }
    });
  });
}
