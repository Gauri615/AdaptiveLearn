import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const OUTPUT_LIMIT = 16 * 1024;
const COMPILE_TIMEOUT_MS = 10000;
const EXECUTION_IMAGE = () => process.env.JAVA_EXECUTION_IMAGE || 'adaptix-java-sandbox:17';

function spawnDocker(args, { input = '', timeoutMs = 5000, outputLimit = OUTPUT_LIMIT } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.DOCKER_CLI || 'docker', args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    let outputExceeded = false;
    let timedOut = false;
    let settled = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    const collect = (stream, text) => {
      const remaining = outputLimit - Buffer.byteLength(stream, 'utf8');
      const chunk = Buffer.from(text);
      if (chunk.length > remaining) {
        outputExceeded = true;
        child.kill();
        return stream + chunk.subarray(0, Math.max(0, remaining)).toString('utf8');
      }
      return stream + text;
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout = collect(stdout, chunk); });
    child.stderr.on('data', chunk => { stderr = collect(stderr, chunk); });
    child.on('error', error => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      resolve({ code, signal, stdout, stderr, timedOut, outputExceeded });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

async function removeContainer(name) {
  try {
    await spawnDocker(['rm', '--force', name], { timeoutMs: 3000, outputLimit: 1024 });
  } catch (error) {
    console.error('Could not explicitly remove timed-out Java container:', error.message);
  }
}

export async function javaSandboxStatus() {
  if (process.env.JAVA_EXECUTION_ENABLED !== 'true') {
    return { configured: false, operational: false, status: 'not_configured' };
  }
  try {
    const info = await spawnDocker(['info', '--format', '{{.ServerVersion}}'], { timeoutMs: 3000, outputLimit: 1024 });
    if (info.code !== 0 || !info.stdout.trim()) {
      return { configured: true, operational: false, status: 'docker_unavailable' };
    }
    const image = await spawnDocker(['image', 'inspect', EXECUTION_IMAGE(), '--format', '{{.Id}}'], { timeoutMs: 3000, outputLimit: 1024 });
    if (image.code !== 0 || !image.stdout.trim()) {
      return { configured: true, operational: false, status: 'sandbox_image_missing' };
    }
    return { configured: true, operational: true, status: 'ready' };
  } catch {
    return { configured: true, operational: false, status: 'docker_unavailable' };
  }
}

export async function executeJava(source, input, { timeLimitMs, memoryLimitMb }) {
  if (process.env.JAVA_EXECUTION_ENABLED !== 'true') {
    return { status: 'internal_execution_error', stdout: '', stderr: 'Java execution is not configured. Ask the administrator to configure the isolated Docker sandbox.', executionTimeMs: 0 };
  }
  const folder = await mkdtemp(path.join(tmpdir(), 'adaptix-java-'));
  const containerName = `adaptix-java-${randomUUID().replaceAll('-', '').slice(0, 20)}`;
  const startedAt = Date.now();
  try {
    await writeFile(path.join(folder, 'Main.java'), source, { encoding: 'utf8', flag: 'wx' });
    const executionSeconds = (timeLimitMs / 1000).toFixed(3);
    const timeoutMarker = `.adaptix-timeout-${randomUUID().replaceAll('-', '')}`;
    const executionScript = `if ! javac -J-Xmx128m -proc:none -encoding UTF-8 -d /work /input/Main.java >/tmp/compile.log 2>&1; then printf "__ADAPTIX_COMPILE_ERROR__\\n"; cat /tmp/compile.log; exit 0; fi; printf "__ADAPTIX_COMPILE_OK__\\n"; (sleep ${executionSeconds}; touch /tmp/${timeoutMarker}; kill -KILL "$program") >/dev/null 2>&1 & watchdog=$!; java -Xms16m -Xmx128m -XX:+UseSerialGC -XX:ActiveProcessorCount=1 -Djava.io.tmpdir=/tmp -cp /work Main & program=$!; wait "$program"; status=$?; kill "$watchdog" 2>/dev/null || true; if [ -f /tmp/${timeoutMarker} ]; then printf "__ADAPTIX_TIME_LIMIT__\\n"; exit 0; fi; exit "$status"`;
    const dockerArgs = [
      'run', '--rm', '--pull=never', '--interactive', '--name', containerName,
      '--label', 'adaptix.execution.job=true',
      '--network', 'none',
      `--memory=${memoryLimitMb}m`, `--memory-swap=${memoryLimitMb}m`,
      '--cpus=0.5', '--pids-limit=64',
      '--read-only', '--user=10001:10001',
      '--security-opt=no-new-privileges', '--cap-drop=ALL',
      '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=16m,uid=10001,gid=10001',
      '--tmpfs', '/work:rw,exec,nosuid,nodev,size=64m,uid=10001,gid=10001',
      '--env', 'HOME=/tmp',
      '--mount', `type=bind,source=${folder},target=/input,readonly`,
      EXECUTION_IMAGE(),
      'sh', '-c',
      executionScript
    ];
    let result;
    try {
      result = await spawnDocker(dockerArgs, { input, timeoutMs: COMPILE_TIMEOUT_MS + timeLimitMs + 5000 });
    } catch {
      return { status: 'internal_execution_error', stdout: '', stderr: 'The isolated Java sandbox could not be started. Check Docker Desktop, image configuration, and host-folder sharing.', executionTimeMs: Date.now() - startedAt };
    }
    if (result.timedOut) {
      await removeContainer(containerName);
      return { status: 'time_limit_exceeded', stdout: '', stderr: 'Execution exceeded the configured time limit.', executionTimeMs: Date.now() - startedAt };
    }
    if (result.outputExceeded) {
      await removeContainer(containerName);
      return { status: 'runtime_error', stdout: result.stdout, stderr: 'Program output exceeded the 16 KB per-stream limit.', executionTimeMs: Date.now() - startedAt };
    }
    const marker = result.stdout.match(/^__ADAPTIX_(COMPILE_ERROR|COMPILE_OK)__\r?\n/);
    if (!marker) {
      return { status: 'internal_execution_error', stdout: '', stderr: 'The isolated Java sandbox failed before returning a compile result.', executionTimeMs: Date.now() - startedAt };
    }
    const stdout = result.stdout.slice(marker[0].length);
    if (marker[1] === 'COMPILE_ERROR') {
      return { status: 'compilation_error', stdout: '', stderr: result.stderr || stdout, executionTimeMs: Date.now() - startedAt };
    }
    const timeLimitMarker = stdout.match(/^__ADAPTIX_TIME_LIMIT__\r?\n/);
    if (timeLimitMarker) {
      return { status: 'time_limit_exceeded', stdout: '', stderr: 'Execution exceeded the configured time limit.', executionTimeMs: Date.now() - startedAt };
    }
    if (result.code !== 0) {
      return { status: 'runtime_error', stdout, stderr: result.stderr || `Java program exited with code ${result.code ?? 'unknown'}.`, executionTimeMs: Date.now() - startedAt };
    }
    return { status: 'completed', stdout, stderr: result.stderr, executionTimeMs: Date.now() - startedAt };
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

export function compareOutput(actual, expected, comparison) {
  if (comparison === 'trim') return actual.trim() === expected.trim();
  if (comparison === 'tokens') return actual.trim().split(/\s+/).filter(Boolean).join(' ') === expected.trim().split(/\s+/).filter(Boolean).join(' ');
  return actual === expected;
}
