import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [port, url, expectedMode, outputDirectory, prefix] = process.argv.slice(2);
if (
  !port ||
  !url ||
  !["project-first", "plugin-first", "project-only"].includes(expectedMode) ||
  !outputDirectory ||
  !prefix
) {
  throw new Error(
    "usage: capture-automations-mention.mjs <port> <url> <project-first|plugin-first|project-only> <output-dir> <prefix>",
  );
}

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = targets.find((target) => target.type === "page");
if (!page) throw new Error("No Electron page target found");

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let callId = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(JSON.stringify(message.error)));
  else resolve(message.result);
});

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++callId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result?.value;
}

async function openMentionMenu() {
  await send("Page.navigate", { url });
  await sleep(3_000);
  await evaluate(`(() => {
    const buttons = [...document.querySelectorAll('button')]
      .filter((element) => (element.innerText || '').trim() === 'New thread');
    buttons.at(-1)?.click();
    return buttons.length;
  })()`);
  await sleep(1_500);
  const focused = await evaluate(`(() => {
    const input = document.querySelector('[contenteditable="true"][role="textbox"]')
      || document.querySelector('[contenteditable="true"]')
      || document.querySelector('textarea');
    if (!input) return false;
    input.focus();
    document.execCommand('selectAll', false);
    document.execCommand('delete', false);
    return true;
  })()`);
  if (!focused) throw new Error("Composer not found");
  await send("Input.insertText", { text: "@automations" });
  await sleep(3_000);
}

async function observe() {
  return evaluate(`(() => {
    const body = document.body.innerText;
    const plugin = body.indexOf('Installed\\nAutomations');
    const project = body.indexOf('Projects\\nAutomations project');
    return {
      width: innerWidth,
      height: innerHeight,
      plugin,
      project,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      title: document.title,
    };
  })()`);
}

function matches(observation) {
  if (observation.overflow || observation.project < 0) return false;
  if (expectedMode === "project-first") {
    return observation.plugin >= 0 && observation.project < observation.plugin;
  }
  if (expectedMode === "plugin-first") {
    return observation.plugin >= 0 && observation.plugin < observation.project;
  }
  return observation.plugin < 0;
}

mkdirSync(outputDirectory, { recursive: true });
await send("Page.enable");
await send("Runtime.enable");

await send("Emulation.setDeviceMetricsOverride", {
  width: 1440,
  height: 900,
  deviceScaleFactor: 2,
  mobile: false,
});
const cycleObservations = [];
for (let cycle = 1; cycle <= 5; cycle += 1) {
  await openMentionMenu();
  cycleObservations.push({ cycle, ...(await observe()) });
}

const transitionObservations = [];
for (const width of [389, 390, 391, 767, 768, 769, 1023, 1024, 1025, 1919, 1920, 1921]) {
  await send("Emulation.setDeviceMetricsOverride", {
    width,
    height: width < 600 ? 844 : width < 1000 ? 900 : 1440,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await openMentionMenu();
  transitionObservations.push(await observe());
}

const viewports = [
  { name: "mobile", width: 390, height: 844, scale: 3 },
  { name: "small-narrow", width: 768, height: 900, scale: 2 },
  { name: "normal-desktop", width: 1440, height: 900, scale: 2 },
  { name: "very-large-desktop", width: 3440, height: 1440, scale: 1 },
];
const captures = [];
for (const viewport of viewports) {
  await send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: viewport.scale,
    mobile: false,
  });
  await openMentionMenu();
  const observation = await observe();
  const screenshot = await send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  const filename = `${prefix}-${viewport.name}.png`;
  writeFileSync(join(outputDirectory, filename), Buffer.from(screenshot.data, "base64"));
  captures.push({ ...viewport, filename, observation });
}

const allObservations = [
  ...cycleObservations,
  ...transitionObservations,
  ...captures.map((capture) => capture.observation),
];
if (!allObservations.every(matches)) {
  throw new Error(
    `Mention relevance verification failed: ${JSON.stringify({ expectedMode, cycleObservations, transitionObservations, captures })}`,
  );
}

const result = {
  expectedMode,
  nativeWindowBounds: { left: 80, top: 80, width: 1280, height: 900 },
  cycles: 5,
  cycleObservations,
  transitionObservations,
  captures,
  result: "PASS",
};
writeFileSync(join(outputDirectory, `${prefix}.json`), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result));
socket.close();
