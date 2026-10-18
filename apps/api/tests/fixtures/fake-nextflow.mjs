#!/usr/bin/env node
// Test double for the `nextflow` CLI (design Testing Strategy). Point NEXTFLOW_BIN at this file.
// `run` reads `-params-file` and an optional `.scenario` file in the launch directory
// (`run/.scenario`): `<name> [delayMs]` where name is success | fail-step | missing-output | hang.
// It never touches the network, Docker or real FASTQ data.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const args = process.argv.slice(2);
const TRACE_HEADER = 'task_id\thash\tnative_id\tname\tstatus\texit\n';
const PROCESS_NAME = 'WF_RENAMEFASTQ:RENAMEFASTQ:FASTCAT';
const HASH = 'ab/cdef12';

if (args[0] === '-version') {
  console.log('nextflow version 26.10.2 (fake)');
  process.exit(0);
}

if (args[0] === 'info') {
  console.log(JSON.stringify({ revisions: { pulled: ['1.0.3'] } }));
  process.exit(0);
}

if (args[0] !== 'run') {
  process.exit(1);
}

const valueOf = (flag) => args[args.indexOf(flag) + 1];
const params = JSON.parse(readFileSync(valueOf('-params-file'), 'utf8'));
const tracePath = valueOf('-with-trace');
const [scenario = 'success', delay = '200'] = existsSync('.scenario')
  ? readFileSync('.scenario', 'utf8').trim().split(/\s+/)
  : [];
const delayMs = Number(delay) || 0;
const taskDirectory = join(process.cwd(), 'work', 'ab', 'cdef1234567890');

// Environment variable names only (never values) so tests can check the child allowlist.
writeFileSync('env-keys.txt', `${Object.keys(process.env).sort().join('\n')}\n`);
mkdirSync(taskDirectory, { recursive: true });
mkdirSync('.nextflow', { recursive: true });
writeFileSync(tracePath, TRACE_HEADER);
console.log(`[${HASH}] Submitted process > ${PROCESS_NAME} (sample)`);

const traceRow = (status, exit) =>
  appendFileSync(tracePath, `1\t${HASH}\t1\t${PROCESS_NAME} (sample)\t${status}\t${exit}\n`);

function writeOutputs() {
  const sample = params.sample || 'sample';
  mkdirSync(join(params.outdir, 'fastq'), { recursive: true });
  mkdirSync(join(params.outdir, 'stats'), { recursive: true });
  writeFileSync(
    join(params.outdir, 'fastq', `${sample}.fastq.gz`),
    gzipSync('@r1\nACGT\n+\nIIII\n'),
  );
  writeFileSync(
    join(params.outdir, 'stats', 'all_fastq_statistics.tsv'),
    'file\tnum_seqs\nsample\t1\n',
  );
}

function containerState() {
  const directory = join(tmpdir(), 'portal-fake-docker');
  mkdirSync(directory, { recursive: true });
  return join(directory, 'containers.json');
}

setTimeout(() => {
  switch (scenario) {
    case 'fail-step':
      traceRow('FAILED', '1');
      console.log(`ERROR ~ Error executing process > '${PROCESS_NAME} (sample)'`);
      process.exit(1);
      break;
    case 'missing-output':
      traceRow('COMPLETED', '0');
      process.exit(0);
      break;
    case 'hang': {
      // Registers a fake task container the way Nextflow names them (`nxf-*`).
      const state = containerState();
      const containers = existsSync(state) ? JSON.parse(readFileSync(state, 'utf8')) : [];
      containers.push({
        id: randomBytes(32).toString('hex'),
        name: `nxf-${randomBytes(18).toString('base64url')}`,
        workingDir: taskDirectory,
      });
      writeFileSync(state, JSON.stringify(containers));
      process.on('SIGTERM', () => {
        traceRow('ABORTED', '-');
        process.exit(143);
      });
      setInterval(() => undefined, 1000);
      break;
    }
    default:
      writeOutputs();
      traceRow('COMPLETED', '0');
      console.log('-[si-lol/wf-renamefastq] Pipeline completed successfully-');
      process.exit(0);
  }
}, delayMs);
