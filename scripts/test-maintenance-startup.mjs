import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const code = readFileSync(new URL('../src/maintenance.js', import.meta.url), 'utf8');
const target = 'https://dl.2407365.xyz:4443/music';
const health = 'https://dl.2407365.xyz:4443/healthz';
const scheduled = [];
let invoked = null;

const root = {
  dataset: {},
  querySelector() { return null; },
};

const windowObject = {
  ANON_MAINTENANCE: { embedded: true, root, target, health },
  __TAURI__: {
    core: {
      async invoke(command, payload) {
        invoked = { command, payload };
      },
    },
  },
  setTimeout(fn, delay) {
    scheduled.push({ fn, delay });
    return scheduled.length;
  },
  setInterval() { return 1; },
  clearInterval() {},
  addEventListener() {},
};

const context = {
  window: windowObject,
  document: {
    documentElement: { dataset: { target, health } },
    getElementById(id) { return id === 'maintenanceRoot' ? root : null; },
  },
  fetch: async () => ({ ok: true, json: async () => ({ status: 'ok' }) }),
  URL,
  Intl,
  AbortSignal,
  navigator: { onLine: true },
  console,
};

vm.runInNewContext(code, context, { filename: 'maintenance.js' });
await new Promise((resolve) => setImmediate(resolve));
await new Promise((resolve) => setImmediate(resolve));

const fastNavigation = scheduled.find(({ delay }) => delay <= 1000);
assert.ok(
  fastNavigation,
  '首次健康检查成功后应在 1 秒内安排跳转，不能等待下一轮 15 秒探测',
);

await fastNavigation.fn();
await new Promise((resolve) => setImmediate(resolve));
assert.equal(invoked?.command, 'open_music');
assert.equal(invoked?.payload?.url, target);
console.log('PASS maintenance startup navigates after first healthy probe');
