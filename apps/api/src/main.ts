import { once } from 'node:events';

import { isAbsolute, resolve } from 'node:path';

import { fileURLToPath } from 'node:url';

import { createGoogleExternalIdentityVerifier } from './auth/providers/google-identity.js';

import { createSignedHumanSessionIdentityResolver } from './auth/human-session-token.js';

import {
  createLawAfriqueDatabasePool,
  verifyLawAfriqueRuntimeDatabase,
} from './runtime/database-runtime.js';

import { createLawAfriqueApiApplication } from './runtime/composition-root.js';

import { loadLawAfriqueApiRuntimeConfig } from './runtime/api-config.js';

import { createLocalPrivateFileStore } from './storage/local-private-file-store.js';

async function main(): Promise<void> {
  const config = loadLawAfriqueApiRuntimeConfig();

  const pool = createLawAfriqueDatabasePool({
    connectionString: config.databaseUrl.reveal(),

    max: config.databasePoolMax,
  });

  let application: ReturnType<typeof createLawAfriqueApiApplication> | null = null;

  let shuttingDown = false;

  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;

    try {
      await application?.close();
    } finally {
      await pool.end();
    }
  };

  process.once('SIGTERM', () => {
    void shutdown().finally(() => {
      process.exitCode = 0;
    });
  });

  process.once('SIGINT', () => {
    void shutdown().finally(() => {
      process.exitCode = 0;
    });
  });

  try {
    /**
     * Mandatory before binding a network port.
     *
     * A superuser/BYPASSRLS/table-owning DATABASE_URL fails startup here.
     */
    await verifyLawAfriqueRuntimeDatabase(pool);

    const humanSessions = createSignedHumanSessionIdentityResolver({
      secret: config.authSecret.reveal(),
    });

    const externalIdentityVerifier = createGoogleExternalIdentityVerifier({
      clientId: config.googleOidcClientId,
    });

    const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));

    const privateStorageDirectory = isAbsolute(config.privateStorageDir)
      ? config.privateStorageDir
      : resolve(repositoryRoot, config.privateStorageDir);

    const privateFiles = createLocalPrivateFileStore(privateStorageDirectory);

    application = createLawAfriqueApiApplication({
      pool,

      privateFiles,

      humanSessions,

      externalIdentityVerifier,

      authSecret: config.authSecret.reveal(),

      synthesisEnvironment: {
        LEGAL_SYNTHESIS_PROVIDER: config.synthesisProvider,

        OPENAI_API_KEY: config.openAiApiKey.reveal(),

        OPENAI_LEGAL_SYNTHESIS_MODEL: config.openAiModel,

        OPENAI_LEGAL_SYNTHESIS_TIMEOUT_MS: String(config.openAiTimeoutMs),

        /**
         * Never opt into paid/live acceptance from normal API startup.
         */
        LIVE_OPENAI_ACCEPTANCE: '0',
      },
    });

    application.server.listen(config.apiPort, config.apiHost);

    await once(application.server, 'listening');

    /**
     * Deliberately no ordinary logging here.
     *
     * Deployment health checks use GET /health.
     */
  } catch (error: unknown) {
    await shutdown();

    throw error;
  }
}

void main().catch(() => {
  /**
   * Fail closed.
   *
   * Do not print secrets, connection URLs, tokens, provider payloads,
   * questions, evidence or raw provider errors.
   */
  process.exitCode = 1;
});
