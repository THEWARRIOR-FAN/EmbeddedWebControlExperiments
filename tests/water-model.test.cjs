// 无第三方依赖：node --test tests/water-model.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'pid-tuner.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function createSimulation() {
  const elements = new Map();
  const context2d = new Proxy({}, { get: () => () => {} });
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      style: {}, classList: { toggle() {}, remove() {}, add() {} },
      clientHeight: 300, value: '', listeners: {},
      addEventListener(name, callback) { this.listeners[name] = callback; },
      getContext() { return context2d; },
      getBoundingClientRect() { return { width: 600, height: 260 }; }
    });
    return elements.get(id);
  }
  const context = vm.createContext({
    document: {
      hidden: false,
      getElementById(id) {
        assert.ok(html.includes(`id="${id}"`), `Missing element: ${id}`);
        return element(id);
      },
      querySelector: element,
      addEventListener() {}
    },
    window: { devicePixelRatio: 1, setTimeout() {}, setInterval() {}, addEventListener() {} },
    requestAnimationFrame() {}
  });
  vm.runInContext(script, context);
  return code => vm.runInContext(code, context);
}

test('20 mm outlet at 0.6 m drains about 0.647 L/s', () => {
  const run = createSimulation();
  assert.ok(Math.abs(run('outletFlow(0.6) * 1000') - 0.6467) < 0.001);
  assert.equal(run('outletFlow(0)'), 0);
});

test('water balance uses real units and preserves constant-height equilibrium', () => {
  const run = createSimulation();
  run(`currentLevel = 0.6; lastMeasurement = 0.6; kp = 0; ki = 0.2;
    integral = outletFlow(0.6) / maxInflow * 100;
    actuator = integral; delayQueue.fill(integral);
    for (let i = 0; i < 2000; i++) pidControl();`);
  assert.ok(Math.abs(run('currentLevel') - 0.6) < 1e-10);
  assert.ok(Math.abs(run('actuator') - 32.34) < 0.1);
});

test('pure P converges to its nonlinear theoretical steady error', () => {
  const run = createSimulation();
  run('loadPreset("pOnly"); for (let i = 0; i < 72000; i++) pidControl();');
  assert.ok(Math.abs(run('setPoint - currentLevel - steadyStateError()')) < 1e-6);
  assert.ok(run('currentLevel > 0 && currentLevel < setPoint'));
  console.log('P steady water level (m):', run('currentLevel'));
});

test('PI and PID presets reach target; target step down recovers', () => {
  // PID 预设带 Kd=20000，收敛比 PI 慢，给 2 小时仿真时间
  const presets = [['pi', 72000], ['pid', 144000]];
  for (const [preset, steps] of presets) {
    const run = createSimulation();
    run(`loadPreset('${preset}'); for (let i = 0; i < ${steps}; i++) pidControl();`);
    assert.ok(Math.abs(run('currentLevel - setPoint')) < 0.001, preset);
    assert.ok(run('actuator >= 0 && actuator <= 100'));
    run(`setPoint = 0.3; for (let i = 0; i < ${steps * 2}; i++) pidControl();`);
    assert.ok(Math.abs(run('currentLevel - 0.3')) < 0.001, `${preset} step down`);
  }
});

test('empty/full boundaries conserve available water and record overflow', () => {
  const run = createSimulation();
  run('kp = 0; ki = 0; kd = 0; for (let i = 0; i < 100; i++) pidControl();');
  assert.equal(run('currentLevel'), 0);
  run(`currentLevel = tankHeight; lastMeasurement = tankHeight;
    setPoint = 2; kp = 1000; actuator = 100; delayQueue.fill(100);`);
  const expectedOverflow = run('(maxInflow - outletFlow(tankHeight)) * dt');
  run('pidControl();');
  assert.equal(run('currentLevel'), 1);
  assert.ok(Math.abs(run('overflowVolume') - expectedOverflow) < 1e-12);
});

test('frame rate independent fixed-step timing, pause, speed and reset', () => {
  function simulate(fps) {
    const run = createSimulation();
    run(`simulationSpeed = 10; loop(0);
      for (let i = 1; i <= ${fps * 10}; i++) loop(i * 1000 / ${fps});`);
    return run;
  }
  const slow = simulate(30);
  const fast = simulate(144);
  // 50× 下按固定步长推进，帧率差异最多造成一个 dt 的累计舍入误差。
  assert.ok(Math.abs(slow('simulationSteps * dt') - 100) <= 0.051);
  assert.ok(Math.abs(slow('currentLevel') - fast('currentLevel')) < 0.001);
  slow('isPaused = true; loop(11000); loop(12000);');
  const pausedSteps = slow('simulationSteps');
  slow('loop(13000);');
  assert.equal(slow('simulationSteps'), pausedSteps);
  slow('resetSystem();');
  assert.equal(slow('simulationSteps'), 0);
  assert.equal(slow('currentLevel'), 0);
  assert.equal(slow('overflowVolume'), 0);
  assert.equal(slow('history[0].time'), 0);
});

test('history keeps absolute simulated timestamps after trimming', () => {
  const run = createSimulation();
  run('for (let i = 0; i < 150000; i++) pidControl();');
  assert.equal(run('history.length'), 7201);
  assert.equal(run('history[0].time'), 300);
  assert.equal(run('formatTime(0)'), '300.0s');
});

test('PID breakdown exposes P/I/D terms, limiting and anti-windup', () => {
  const run = createSimulation();
  // 纯 P 且输出超限：P=600% 被限到 100%，积分应暂停累积
  run('kp = 1000; ki = 0.2; pidControl();');
  assert.equal(run('valveOpen'), 100);
  assert.equal(run('integral'), 0);
  assert.equal(run('controlOutput.integrating'), false);
  assert.equal(run('controlOutput.p + controlOutput.i + controlOutput.d'), run('controlOutput.raw'));
  run('updateReadout();');
  assert.equal(run('document.getElementById("pOutput").textContent'), run('controlOutput.p.toFixed(1)'));
  assert.ok(run('document.getElementById("saturationStatus").textContent').includes('上限饱和'));
  assert.ok(run('document.getElementById("controlChain").textContent').includes('计算链'));

  // 目标突变不应产生微分冲击：D 只看水位变化速度
  run('resetSystem(); kp = 0; kd = 50; setPoint = 0.8; pidControl();');
  assert.equal(run('Math.abs(controlOutput.d)'), 0);

  // 未饱和时积分正常累积
  run('kp = 0; ki = 0.2; pidControl();');
  assert.equal(run('controlOutput.integrating'), true);
  assert.ok(run('integral') > 0);
  run('updateReadout();');
  assert.ok(run('document.getElementById("saturationStatus").textContent').includes('积分正在累积'));
});

test('preset status explains expected phenomenon for learners', () => {
  const run = createSimulation();
  run('loadPreset("pOnly");');
  assert.ok(run('document.getElementById("tuneStatus").textContent').includes('静差'));
  run('loadPreset("pi");');
  assert.ok(run('document.getElementById("tuneStatus").textContent').includes('静差消失'));
  run('loadPreset("pid");');
  assert.ok(run('document.getElementById("tuneStatus").textContent').includes('D 项'));
});

test('simulation speed offers fast 50x and 100x options', () => {
  assert.match(html, /<option value="50" selected>50×<\/option>/);
  assert.match(html, /<option value="100">100×<\/option>/);
});

test('slider ranges match the calibration targets', () => {
  // 滑块范围只是本教学模型的操作边界，不代表真实设备的整定答案
  assert.match(html, /id="setPoint" min="0" max="1" step="0\.1"/);
  assert.match(html, /id="kp" min="0" max="1000" step="0\.1"/);
  assert.match(html, /id="ki" min="0" max="5" step="0\.05"/);
  assert.match(html, /id="kd" min="0" max="20000" step="100"/);
  assert.match(script, /let kp = 200\.0;\s*\n\s*let ki = 0\.0;/);    // 默认纯 P
  assert.match(script, /kd = 20000\.0;/);                            // PID 预设用可见的 D
});

function measureOvershoot(setup, steps) {
  const run = createSimulation();
  run(`${setup}; let maxH = 0;
    for (let i = 0; i < ${steps}; i++) { pidControl(); if (currentLevel > maxH) maxH = currentLevel; }`);
  return (run('maxH') - run('setPoint')) * 1000; // mm
}

test('calibration: Ki creates overshoot, stronger Ki peaks around 1-2', () => {
  const weak = measureOvershoot('kp = 200; ki = 0.2; kd = 0;', 72000);
  const strong = measureOvershoot('kp = 200; ki = 1; kd = 0;', 72000);
  assert.ok(weak < 5, `Ki=0.2 应几乎无超调，实测 ${weak.toFixed(1)} mm`);
  assert.ok(strong > 50, `Ki=1 应有明显超调，实测 ${strong.toFixed(1)} mm`);
});

test('calibration: larger Kd increases overshoot in this inertialess tank', () => {
  const withoutD = measureOvershoot('kp = 200; ki = 0.2; kd = 0;', 72000);
  const withD = measureOvershoot('kp = 200; ki = 0.2; kd = 20000;', 72000);
  assert.ok(withD - withoutD > 10,
    `Kd=20000 应比无 D 多约 20 mm 超调，实测差 ${(withD - withoutD).toFixed(1)} mm`);
});
