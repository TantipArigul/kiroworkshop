import { createTestDatabaseContext } from '../../src/infrastructure/test-database.js';

export function createTestEnvironment() {
  return createTestDatabaseContext();
}
