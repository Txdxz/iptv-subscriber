/**
 * run_tests.js
 * 全覆盖自动化测试套件
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const {
  parseSourceType,
  matchPriorityTier,
  isStatusAccepted,
  sortCandidates,
  selectOptimalSource
} = require('../src/selector');
const M3uValidator = require('../src/validator');
const StorageManager = require('../src/storage');
const M3uServer = require('../src/server');

const TEST_DIR = path.resolve(__dirname, '../data/test_env');

function setupTestEnv() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_DIR, { recursive: true });
}

function teardownTestEnv() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

const mockPriorities = [
  { id: 1, name: "山西太原 山西电信", province: "山西", city: "太原", isp: "电信" },
  { id: 2, name: "山西太原 山西联通", province: "山西", city: "太原", isp: "联通" },
  { id: 3, name: "山西其他城市电信", province: "山西", city_not: "太原", isp: "电信" },
  { id: 4, name: "山西其他城市联通", province: "山西", city_not: "太原", isp: "联通" },
  { id: 5, name: "山西其他城市移动", province: "山西", city_not: "太原", isp: "移动" },
  { id: 6, name: "天津 天津联通", province: "天津", city: "天津", isp: "联通" },
  { id: 7, name: "北京 北京联通", province: "北京", city: "北京", isp: "联通" },
  { id: 8, name: "上海 上海电信", province: "上海", city: "上海", isp: "电信" },
  { id: 9, name: "上海 上海联通", province: "上海", city: "上海", isp: "联通" }
];

class MockResponse extends EventEmitter {
  constructor() {
    super();
    this.headers = {};
    this.statusCode = 0;
    this.body = '';
  }
  writeHead(status, headers) {
    this.statusCode = status;
    this.headers = headers;
  }
  end(content) {
    this.body = content;
    this.emit('finish');
  }
}

async function runAllTests() {
  console.log('🧪 开始执行全覆盖自动化测试套件...\n');
  let passedCount = 0;

  function testCase(name, fn) {
    try {
      fn();
      console.log(`  ✅ [PASS] ${name}`);
      passedCount++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${name}:`, err.message);
      throw err;
    }
  }

  async function testCaseAsync(name, fn) {
    try {
      await fn();
      console.log(`  ✅ [PASS] ${name}`);
      passedCount++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${name}:`, err.message);
      throw err;
    }
  }

  testCase('测试 1: 严格区分山西与陕西，绝不混淆', () => {
    const sx1 = parseSourceType('山西太原酒店 山西联通');
    assert.strictEqual(sx1.province, '山西');
    assert.strictEqual(sx1.city, '太原');
    assert.strictEqual(sx1.isp, '联通');

    const sn1 = parseSourceType('陕西西安组播 陕西电信');
    assert.strictEqual(sn1.province, '陕西');
    assert.strictEqual(sn1.city, '西安');
    assert.strictEqual(sn1.isp, '电信');

    const tierSn = matchPriorityTier(sn1, mockPriorities);
    assert.strictEqual(tierSn, null);
  });

  testCase('测试 2: 城市与运营商档位匹配逻辑', () => {
    const tyDx = parseSourceType('山西太原组播 山西电信');
    assert.strictEqual(matchPriorityTier(tyDx, mockPriorities).id, 1);

    const tyLt = parseSourceType('山西太原酒店 山西联通');
    assert.strictEqual(matchPriorityTier(tyLt, mockPriorities).id, 2);

    const llDx = parseSourceType('山西临汾酒店 山西电信');
    assert.strictEqual(matchPriorityTier(llDx, mockPriorities).id, 3);

    const llLt = parseSourceType('山西吕梁酒店 山西联通');
    assert.strictEqual(matchPriorityTier(llLt, mockPriorities).id, 4);

    const czYd = parseSourceType('山西长治组播 山西移动');
    assert.strictEqual(matchPriorityTier(czYd, mockPriorities).id, 5);

    const tjLt = parseSourceType('天津组播 天津联通');
    assert.strictEqual(matchPriorityTier(tjLt, mockPriorities).id, 6);

    const bjLt = parseSourceType('北京组播 北京联通');
    assert.strictEqual(matchPriorityTier(bjLt, mockPriorities).id, 7);

    const shDx = parseSourceType('上海酒店 上海电信');
    assert.strictEqual(matchPriorityTier(shDx, mockPriorities).id, 8);

    const shLt = parseSourceType('上海组播 上海联通');
    assert.strictEqual(matchPriorityTier(shLt, mockPriorities).id, 9);
  });

  testCase('测试 3: 状态过滤规则 (新上线/存活x天 vs 暂时失效)', () => {
    assert.strictEqual(isStatusAccepted('新上线'), true);
    assert.strictEqual(isStatusAccepted('存活1天'), true);
    assert.strictEqual(isStatusAccepted('存活15天'), true);
    assert.strictEqual(isStatusAccepted('暂时失效'), false);
  });

  testCase('测试 4: 同档位多候选排序 (更新时间 > 节目数 > 稳定ID)', () => {
    const list = [
      { p: 'c', count: 50, update_time: '2026-10-08 10:00:00' },
      { p: 'a', count: 80, update_time: '2026-10-08 12:00:00' },
      { p: 'b', count: 30, update_time: '2026-10-08 12:00:00' },
      { p: 'd', count: 50, update_time: '2026-10-08 10:00:00' }
    ];
    const sorted = sortCandidates(list);
    assert.strictEqual(sorted[0].p, 'a');
    assert.strictEqual(sorted[1].p, 'b');
    assert.strictEqual(sorted[2].p, 'c');
    assert.strictEqual(sorted[3].p, 'd');
  });

  await testCaseAsync('测试 5: M3U 格式校验、频道提取与错误拦截', async () => {
    const validator = new M3uValidator({ enable_stream_probe: false, min_channels_threshold: 2 });
    const r1 = await validator.validate('');
    assert.strictEqual(r1.isValid, false);

    const htmlError = '<!DOCTYPE html><html><title>安全验证</title><body>403</body></html>';
    const r2 = await validator.validate(htmlError);
    assert.strictEqual(r2.isValid, false);

    const validM3u = `#EXTM3U\n#EXTINF:-1 tvg-id="CCTV1",CCTV-1\nhttp://example.com/1.m3u8?token=xyz\n#EXTINF:-1 tvg-id="CCTV2",CCTV-2\nhttp://example.com/2.m3u8\n`;
    const r3 = await validator.validate(validM3u);
    assert.strictEqual(r3.isValid, true);
    assert.strictEqual(r3.channelCount, 2);
  });

  await testCaseAsync('测试 6: 高优先级成功短路机制 (P1 成功不检查 P2-P9)', async () => {
    const validator = new M3uValidator({ enable_stream_probe: false, min_channels_threshold: 1 });
    let queriedProvinces = [];

    const mockClient = {
      async fetchSourceList({ province }) {
        queriedProvinces.push(province);
        return {
          sources: [
            {
              ip: '1.1.1.1',
              p: 'p1_token',
              t: 'hotel',
              count: 100,
              type: '山西太原组播 山西电信',
              status: '新上线',
              update_time: '2026-10-08 12:00:00'
            }
          ],
          pagination: { has_next_page: false }
        };
      },
      async fetchSourceDetail() { return { s: 's1' }; },
      async fetchM3UContent() { return '#EXTM3U\n#EXTINF:-1,CCTV\nhttp://1.1.1.1/live.m3u8\n'; }
    };

    const res = await selectOptimalSource(mockClient, validator, mockPriorities, null, () => {});
    assert.ok(res !== null);
    assert.strictEqual(res.tier.id, 1);
    assert.strictEqual(queriedProvinces.length, 1);
  });

  await testCaseAsync('测试 7: 高优先级失败自动顺序降级', async () => {
    const validator = new M3uValidator({ enable_stream_probe: false, min_channels_threshold: 1 });

    const mockClient = {
      async fetchSourceList() {
        return {
          sources: [
            {
              ip: '2.2.2.2',
              p: 'p2_token',
              t: 'hotel',
              count: 88,
              type: '山西太原酒店 山西联通',
              status: '新上线',
              update_time: '2026-10-08 12:00:00'
            }
          ],
          pagination: { has_next_page: false }
        };
      },
      async fetchSourceDetail() { return { s: 's2' }; },
      async fetchM3UContent() { return '#EXTM3U\n#EXTINF:-1,CCTV\nhttp://2.2.2.2/live.m3u8\n'; }
    };

    const res = await selectOptimalSource(mockClient, validator, mockPriorities, null, () => {});
    assert.ok(res !== null);
    assert.strictEqual(res.tier.id, 2);
  });

  await testCaseAsync('测试 8: 上期存活源优先沿用机制', async () => {
    const validator = new M3uValidator({ enable_stream_probe: false });

    const lastSource = {
      ip: '9.9.9.9',
      p: 'last_p',
      t: 'hotel',
      type: '山西太原酒店 山西联通',
      status: '存活3天',
      count: 90
    };

    const mockClient = {
      async checkSourceStillAlive() {
        return { isAlive: true, status: '存活4天', s: 's_last' };
      },
      async fetchSourceList() {
        throw new Error('沿用成功时不应调用列表查询');
      }
    };

    const res = await selectOptimalSource(mockClient, validator, mockPriorities, lastSource, () => {});
    assert.ok(res !== null);
    assert.strictEqual(res.isRetained, true);
    assert.strictEqual(res.source.status, '存活4天');
  });

  testCase('测试 9: 全部失败保护机制 (保留现有版本，记录失败状态)', () => {
    setupTestEnv();
    const storage = new StorageManager({
      data_dir: TEST_DIR,
      current_m3u_file: path.join(TEST_DIR, 'current.m3u'),
      state_file: path.join(TEST_DIR, 'state.json'),
      history_dir: path.join(TEST_DIR, 'history')
    });

    const initialContent = '#EXTM3U\n#EXTINF:-1,Historic CCTV\nhttp://example.com/h.m3u8\n';
    storage.atomicUpdateM3u(initialContent, { ip: 'old_ip' });

    storage.recordFailure('所有档位均失败');

    const current = storage.getCurrentM3u();
    assert.strictEqual(current, initialContent);

    const state = storage.loadState();
    assert.strictEqual(state.consecutive_failures, 1);
    assert.strictEqual(state.current_source.ip, 'old_ip');

    teardownTestEnv();
  });

  testCase('测试 10: 冷启动首次运行失败明确提示', () => {
    setupTestEnv();
    const storage = new StorageManager({
      data_dir: TEST_DIR,
      current_m3u_file: path.join(TEST_DIR, 'current.m3u'),
      state_file: path.join(TEST_DIR, 'state.json'),
      history_dir: path.join(TEST_DIR, 'history')
    });

    assert.strictEqual(storage.getCurrentM3u(), null);
    storage.recordFailure('首次启动抓取失败');
    const state = storage.loadState();
    assert.strictEqual(state.last_success_time, null);
    assert.strictEqual(state.consecutive_failures, 1);

    teardownTestEnv();
  });

  testCase('测试 11: 任务并发锁获取与释放', () => {
    setupTestEnv();
    const storage1 = new StorageManager({
      data_dir: TEST_DIR,
      lock_file: path.join(TEST_DIR, 'task.lock')
    });
    const storage2 = new StorageManager({
      data_dir: TEST_DIR,
      lock_file: path.join(TEST_DIR, 'task.lock')
    });

    const lock1 = storage1.acquireLock();
    assert.strictEqual(lock1, true);

    const lock2 = storage2.acquireLock();
    assert.strictEqual(lock2, false);

    storage1.releaseLock();
    const lock3 = storage2.acquireLock();
    assert.strictEqual(lock3, true);
    storage2.releaseLock();

    teardownTestEnv();
  });

  testCase('测试 12: 内置 HTTP 服务的固定订阅与状态响应', () => {
    setupTestEnv();
    const storage = new StorageManager({
      data_dir: TEST_DIR,
      current_m3u_file: path.join(TEST_DIR, 'current.m3u'),
      state_file: path.join(TEST_DIR, 'state.json')
    });
    const m3uContent = '#EXTM3U\n#EXTINF:-1,CCTV1\nhttp://example.com/1.m3u8\n';
    storage.atomicUpdateM3u(m3uContent, { ip: '1.2.3.4' });

    const server = new M3uServer({
      port: 8088,
      m3u_route: '/iptv/current.m3u',
      status_route: '/iptv/status'
    }, storage);

    const reqM3u = { url: '/iptv/current.m3u', headers: { host: 'localhost:8088' } };
    const resM3u = new MockResponse();
    server._handleRequest(reqM3u, resM3u);
    assert.strictEqual(resM3u.statusCode, 200);
    assert.strictEqual(resM3u.headers['Content-Type'], 'application/vnd.apple.mpegurl; charset=utf-8');

    const reqStatus = { url: '/iptv/status', headers: { host: 'localhost:8088' } };
    const resStatus = new MockResponse();
    server._handleRequest(reqStatus, resStatus);
    assert.strictEqual(resStatus.statusCode, 200);

    teardownTestEnv();
  });

  console.log(`\n🎉 全部 ${passedCount} 个测试用例均 100% 通过！\n`);
}

runAllTests().catch(err => {
  console.error('\n❌ 测试套件执行出现未捕获异常:', err);
  process.exit(1);
});
