#!/usr/bin/env node
// Test double for the `docker` CLI commands the Nextflow adapter uses. Point DOCKER_BIN at this
// file. Containers are the records `fake-nextflow.mjs` (scenario `hang`) writes to
// `$TMPDIR/portal-fake-docker/containers.json`; nothing talks to a real Docker daemon.
// Test knobs in the same directory: every call is appended to `docker-calls.log` (one JSON
// argument array per line) and refs listed in `missing-images.txt` are "not pulled".
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const directory = join(tmpdir(), 'portal-fake-docker');
const statePath = join(directory, 'containers.json');

function load() {
  return existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : [];
}

function save(containers) {
  if (!existsSync(tmpdir())) {
    return;
  }
  mkdirSync(directory, { recursive: true });
  writeFileSync(statePath, JSON.stringify(containers));
}

// Never re-create a test sandbox that was already removed (a late readiness call after
// teardown): record only while the private TMPDIR still exists.
const recording = existsSync(tmpdir());
if (recording) {
  mkdirSync(directory, { recursive: true });
  appendFileSync(join(directory, 'docker-calls.log'), `${JSON.stringify(args)}\n`);
}
const missingImages = existsSync(join(directory, 'missing-images.txt'))
  ? readFileSync(join(directory, 'missing-images.txt'), 'utf8').split('\n').filter(Boolean)
  : [];
const [command, ...rest] = args;

switch (command) {
  case 'info':
    console.log('Server Version: fake');
    break;
  case 'image': {
    // `docker image inspect [--format …] <ref>`: every image is "present" with a fake digest.
    const ref = rest[rest.length - 1] ?? '';
    if (missingImages.includes(ref)) {
      console.error(`Error: No such image: ${ref}`);
      process.exit(1);
    }
    const repository = ref.replace(/:[^/:]+$/, '');
    console.log(rest.includes('--format') ? `["${repository}@sha256:${'0'.repeat(64)}"]` : '[]');
    break;
  }
  case 'pull':
    // `docker pull --platform <platform> <ref>` (pipelines:setup); nothing is downloaded.
    console.log(`fake pull ${rest[rest.length - 1] ?? ''}`);
    break;
  case 'tag':
    // `docker tag <source> <ref>` (pipelines:setup, registry `source`); nothing is changed.
    break;
  case 'run':
    // `docker run --rm … test -d <target>` (pipelines:check file-sharing check).
    break;
  case 'ps': {
    const filter = rest[rest.indexOf('--filter') + 1] ?? '';
    const name = filter.startsWith('name=') ? filter.slice('name='.length) : '';
    for (const container of load().filter((item) => item.name.includes(name))) {
      console.log(container.id.slice(0, 12));
    }
    break;
  }
  case 'inspect': {
    const ids = rest.slice(rest.indexOf('--format') + 2);
    let missing = false;
    for (const id of ids) {
      const container = load().find((item) => item.id.startsWith(id));
      if (container) {
        console.log(`${container.id} ${container.workingDir}`);
      } else {
        missing = true;
        console.error(`Error: No such object: ${id}`);
      }
    }
    process.exit(missing ? 1 : 0);
    break;
  }
  case 'rm': {
    const ids = rest.filter((value) => value !== '-f');
    save(load().filter((item) => !ids.some((id) => item.id.startsWith(id))));
    for (const id of ids) {
      console.log(id);
    }
    break;
  }
  default:
    process.exit(1);
}
