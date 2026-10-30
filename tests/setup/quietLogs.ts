import { logger } from '../../src/utils/logger';

/**
 * Many tests drive failure paths on purpose (rejected auth, HTTP 500s, malformed records), and the app
 * logs those as real warnings and errors. Hide that output so a passing run reads clean and genuine
 * failures stand out. Set SANCTUARY_TEST_LOGS=1 to see every log while debugging a test.
 */
if (process.env.SANCTUARY_TEST_LOGS !== '1') {
  logger.settings.type = 'hidden';
  console.warn = () => undefined;
  console.error = () => undefined;
}
