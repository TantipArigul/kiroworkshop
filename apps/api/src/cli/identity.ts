/**
 * Identity Admin CLI — Twelve-Factor one-off admin process (design C7).
 *
 * Run from the repository root after `pnpm --filter @portal/api build`:
 *   node --env-file=.env apps/api/dist/cli/identity.js <command> [options]
 *
 * Passwords are read from a hidden prompt, or from IDENTITY_CLI_PASSWORD when stdin is not a
 * terminal. They are never accepted as command-line arguments (shell history, process list).
 */
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { parseArgs } from 'node:util';

import { ConfigValidationError, loadConfig } from '../config/index.js';
import { createPrismaClient } from '../infrastructure/prisma.js';
import { createAuditService } from '../modules/audit/audit.service.js';
import {
  createIdentityService,
  IdentityOperationError,
  PasswordPolicyError,
  type IdentityService,
} from '../modules/identity/identity.service.js';
import { PASSWORD_VIOLATION_MESSAGES } from '../modules/identity/password-policy.js';
import { createLogger } from '../shared/logger.js';

const EXIT_OK = 0;
const EXIT_FAILURE = 1;
const EXIT_USAGE = 2;

const USAGE = `Usage: identity <command> [options]

User commands:
  user:create          --email <e-mail> --role <USER|AUDITOR|ADMIN>   (prompts for a temporary password)
  user:reset-password  --email <e-mail>                               (prompts for a temporary password)
  user:disable         --email <e-mail>
  user:enable          --email <e-mail>
  user:set-role        --email <e-mail> --role <USER|AUDITOR|ADMIN>
  user:anonymize       --email <e-mail>

Every command writes an audit event. Created and reset accounts must change their password
at the next sign-in. Set IDENTITY_CLI_PASSWORD only for non-interactive runs.`;

class UsageError extends Error {}

type CommandContext = {
  identity: IdentityService;
  email: string;
  role: string | undefined;
  requestId: string;
};

const commands: Record<string, (context: CommandContext) => Promise<string>> = {
  'user:create': async ({ email, identity, requestId, role }) => {
    const user = await identity.createUser({
      email,
      password: await readNewPassword('Temporary password'),
      requestId,
      role: requireOption(role, '--role'),
    });
    return `Created account ${user.id} with role ${user.role}. A password change is required at first sign-in.`;
  },
  'user:reset-password': async ({ email, identity, requestId }) => {
    await identity.resetPassword({
      email,
      requestId,
      temporaryPassword: await readNewPassword('Temporary password'),
    });
    return 'Password reset. All sessions were signed out and a password change is required.';
  },
  'user:disable': async ({ email, identity, requestId }) => {
    await identity.setDisabled({ disabled: true, email, requestId });
    return 'Account disabled and all sessions signed out.';
  },
  'user:enable': async ({ email, identity, requestId }) => {
    await identity.setDisabled({ disabled: false, email, requestId });
    return 'Account enabled.';
  },
  'user:set-role': async ({ email, identity, requestId, role }) => {
    await identity.setRole({ email, requestId, role: requireOption(role, '--role') });
    return 'Role updated and all sessions signed out.';
  },
  'user:anonymize': async ({ email, identity, requestId }) => {
    await identity.anonymizeUser({ email, requestId });
    return 'Account anonymized: e-mail and password removed, account disabled.';
  },
};

async function main(argv: readonly string[]): Promise<number> {
  let parsed: ReturnType<typeof parseCommandLine>;

  try {
    parsed = parseCommandLine(argv);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'Invalid arguments.'}\n\n${USAGE}\n`,
    );
    return EXIT_USAGE;
  }

  if (parsed.help || !parsed.command) {
    process.stdout.write(`${USAGE}\n`);
    return parsed.help ? EXIT_OK : EXIT_USAGE;
  }

  const run = commands[parsed.command];

  if (!run) {
    process.stderr.write(`Unknown command "${parsed.command}".\n\n${USAGE}\n`);
    return EXIT_USAGE;
  }

  let config: ReturnType<typeof loadConfig>;

  try {
    config = loadConfig(process.env);
  } catch (error) {
    const fields = error instanceof ConfigValidationError ? error.fields.join(', ') : 'unknown';
    process.stderr.write(`Configuration is invalid (${fields}). Check the environment file.\n`);
    return EXIT_FAILURE;
  }

  const prisma = createPrismaClient(config.databaseUrl);
  const logger = createLogger(config);
  const audit = createAuditService(prisma, logger);
  const identity = createIdentityService({ audit, config, prisma });

  try {
    const message = await run({
      email: requireOption(parsed.email, '--email'),
      identity,
      requestId: randomUUID(),
      role: parsed.role,
    });
    process.stdout.write(`${message}\n`);
    return EXIT_OK;
  } catch (error) {
    process.stderr.write(`${describeError(error)}\n`);
    return error instanceof UsageError ? EXIT_USAGE : EXIT_FAILURE;
  } finally {
    await prisma.$disconnect();
  }
}

function parseCommandLine(argv: readonly string[]) {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    args: [...argv],
    options: {
      email: { type: 'string' },
      help: { short: 'h', type: 'boolean' },
      role: { type: 'string' },
    },
    strict: true,
  });

  if (positionals.length > 1) {
    throw new UsageError('Only one command can be run at a time.');
  }

  return { command: positionals[0], email: values.email, help: values.help, role: values.role };
}

function requireOption(value: string | undefined, name: string): string {
  if (!value) {
    throw new UsageError(`Missing required option ${name}.`);
  }

  return value;
}

/** Hidden, confirmed prompt; falls back to IDENTITY_CLI_PASSWORD for non-interactive runs. */
async function readNewPassword(label: string): Promise<string> {
  if (!process.stdin.isTTY) {
    const fromEnvironment = process.env.IDENTITY_CLI_PASSWORD;

    if (!fromEnvironment) {
      throw new UsageError('No terminal available: set IDENTITY_CLI_PASSWORD for this run.');
    }

    return fromEnvironment;
  }

  const password = await promptHidden(`${label}: `);
  const confirmation = await promptHidden(`Confirm ${label.toLowerCase()}: `);

  if (password !== confirmation) {
    throw new UsageError('The passwords do not match.');
  }

  return password;
}

async function promptHidden(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  // A muted output stream keeps typed characters from being echoed to the terminal.
  const muted = new Writable({ write: (_chunk, _encoding, callback) => callback() });
  const readline = createInterface({ input: process.stdin, output: muted, terminal: true });

  try {
    return await readline.question('');
  } finally {
    readline.close();
    process.stdout.write('\n');
  }
}

function describeError(error: unknown): string {
  if (error instanceof PasswordPolicyError) {
    return `Password rejected: ${error.violations.map((violation) => PASSWORD_VIOLATION_MESSAGES[violation]).join(' ')}`;
  }

  if (error instanceof IdentityOperationError || error instanceof UsageError) {
    return error.message;
  }

  // Never print stack traces, SQL or the database path to the operator's terminal.
  return 'The command failed. Check the application logs for details.';
}

process.exitCode = await main(process.argv.slice(2));
