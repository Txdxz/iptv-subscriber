const SHANXI_CITIES = [
  '太原', '大同', '阳泉', '长治', '晋城', '朔州', '晋中', '运城', '忻州', '临汾', '吕梁'
];

const PROVINCE_TO_CODE = {
  '山西': 'sx',
  '天津': 'tj',
  '北京': 'bj',
  '上海': 'sh',
  '陕西': 'sn'
};

function parseSourceType(typeStr = '') {
  const text = String(typeStr).trim();
  let province = '';
  let city = '';
  let isp = '';
  let sourceType = '';

  if (text.includes('陕西')) {
    province = '陕西';
  } else if (text.includes('山西')) {
    province = '山西';
  } else if (text.includes('北京')) {
    province = '北京';
    city = '北京';
  } else if (text.includes('天津')) {
    province = '天津';
    city = '天津';
  } else if (text.includes('上海')) {
    province = '上海';
    city = '上海';
  } else if (text.includes('重庆')) {
    province = '重庆';
    city = '重庆';
  }

  if (province === '山西') {
    for (const c of SHANXI_CITIES) {
      if (text.includes(c)) {
        city = c;
        break;
      }
    }
  } else if (province === '陕西') {
    if (text.includes('西安')) city = '西安';
  }

  if (text.includes('电信')) {
    isp = '电信';
  } else if (text.includes('联通')) {
    isp = '联通';
  } else if (text.includes('移动')) {
    isp = '移动';
  } else if (text.includes('广电')) {
    isp = '广电';
  }

  if (text.includes('酒店')) {
    sourceType = '酒店';
  } else if (text.includes('组播')) {
    sourceType = '组播';
  } else if (text.includes('咪咕')) {
    sourceType = '咪咕';
  } else {
    sourceType = '其他';
  }

  return {
    raw: text,
    province,
    city,
    isp,
    sourceType
  };
}

function isStatusAccepted(status = '') {
  const s = String(status).trim();
  if (!s || s === '暂时失效' || s.includes('失效') || s.includes('离线')) {
    return false;
  }
  return s === '新上线' || /^存活\d+天$/.test(s);
}

function matchPriorityTier(parsed, prioritiesConfig = []) {
  if (!parsed || !parsed.province) return null;

  for (const tier of prioritiesConfig) {
    if (tier.province && parsed.province !== tier.province) {
      continue;
    }
    if (tier.city && parsed.city !== tier.city) {
      continue;
    }
    if (tier.city_not && parsed.city === tier.city_not) {
      continue;
    }
    if (tier.isp && parsed.isp !== tier.isp) {
      continue;
    }
    return tier;
  }

  return null;
}

function sortCandidates(candidates = []) {
  return [...candidates].sort((a, b) => {
    const timeA = new Date(a.update_time).getTime() || 0;
    const timeB = new Date(b.update_time).getTime() || 0;
    if (timeB !== timeA) {
      return timeB - timeA;
    }

    const countA = a.count || 0;
    const countB = b.count || 0;
    if (countB !== countA) {
      return countB - countA;
    }

    return String(a.p).localeCompare(String(b.p));
  });
}

async function selectOptimalSource(client, validator, prioritiesConfig, lastSelectedSource = null, logger = console.log) {
  logger('[Selector] 开始执行 IPTV 源自动化筛选...');

  if (lastSelectedSource && lastSelectedSource.p && lastSelectedSource.t) {
    logger(`[Selector] 正在复检上次已选源: IP=${lastSelectedSource.ip}, P=${lastSelectedSource.p}`);
    const aliveCheck = await client.checkSourceStillAlive(lastSelectedSource.p, lastSelectedSource.t);
    if (aliveCheck && aliveCheck.isAlive) {
      logger(`[Selector] 上次选中的源当前状态依然存活 (${aliveCheck.status})，触发沿用机制，立即停止当日筛选。`);
      return {
        isRetained: true,
        source: {
          ...lastSelectedSource,
          status: aliveCheck.status,
          s: aliveCheck.s || lastSelectedSource.s
        },
        tier: lastSelectedSource.tier || { name: '上期优选源(沿用)' },
        reason: `沿用上期源，网站状态为【${aliveCheck.status}】`
      };
    } else {
      logger(`[Selector] 上次选中的源已失效或不可达 (${aliveCheck.status || aliveCheck.error || '失效'})，开始按优先级档位重新筛选。`);
    }
  }

  for (const tier of prioritiesConfig) {
    logger(`[Selector] === 检查优先级 [P${tier.id}] ${tier.name} ===`);
    const provinceCode = PROVINCE_TO_CODE[tier.province] || 'all';

    let tierCandidates = [];
    let currentPage = 1;
    let maxPages = 3;

    while (currentPage <= maxPages) {
      logger(`[Selector] 正在获取省份 [${tier.province}] (code=${provinceCode}) 第 ${currentPage} 页数据...`);
      let listResult;
      try {
        listResult = await client.fetchSourceList({
          province: provinceCode,
          limit: 10,
          page: currentPage
        });
      } catch (err) {
        logger(`[Selector] 获取第 ${currentPage} 页失败: ${err.message}`);
        break;
      }

      const sources = listResult.sources || [];
      if (sources.length === 0) break;

      for (const src of sources) {
        if (!isStatusAccepted(src.status)) {
          continue;
        }

        const parsed = parseSourceType(src.type);
        const matchedTier = matchPriorityTier(parsed, [tier]);
        if (matchedTier && matchedTier.id === tier.id) {
          tierCandidates.push({
            ...src,
            parsed,
            tier
          });
        }
      }

      if (!listResult.pagination || !listResult.pagination.has_next_page) {
        break;
      }
      currentPage++;
    }

    if (tierCandidates.length === 0) {
      logger(`[Selector] 优先级 [P${tier.id}] ${tier.name} 未找到符合状态要求的候选源，降级到下一优先级。`);
      continue;
    }

    tierCandidates = sortCandidates(tierCandidates);
    logger(`[Selector] 优先级 [P${tier.id}] 匹配到 ${tierCandidates.length} 个候选源，开始依次验证...`);

    for (let i = 0; i < tierCandidates.length; i++) {
      const candidate = tierCandidates[i];
      logger(`[Selector] [P${tier.id} 候选 ${i + 1}/${tierCandidates.length}] 验证 IP=${candidate.ip}, 状态=${candidate.status}, 节目数=${candidate.count}, 更新时间=${candidate.update_time}`);

      try {
        const detail = await client.fetchSourceDetail(candidate.p, candidate.t);
        candidate.s = detail.s;

        const rawM3u = await client.fetchM3UContent(candidate.s, candidate.t);

        const validationResult = await validator.validate(rawM3u, {
          sourceIp: candidate.ip,
          sourceName: candidate.type
        });

        if (validationResult.isValid) {
          logger(`[Selector] ✅ 候选源通过验证！[P${tier.id}] ${candidate.type} (${candidate.ip}), 实际有效频道数: ${validationResult.channelCount}`);
          return {
            isRetained: false,
            source: candidate,
            tier,
            m3uContent: validationResult.normalizedM3u,
            channelCount: validationResult.channelCount,
            validationDetails: validationResult.details
          };
        } else {
          logger(`[Selector] ❌ 候选源验证未通过: ${validationResult.reason}`);
        }
      } catch (err) {
        logger(`[Selector] ❌ 候选源处理异常: ${err.message}`);
      }
    }

    logger(`[Selector] 优先级 [P${tier.id}] 的所有候选源均未能通过验证，降级到下一优先级。`);
  }

  logger('[Selector] ⚠️ 所有优先级档位均未能找到可用源！');
  return null;
}

module.exports = {
  SHANXI_CITIES,
  PROVINCE_TO_CODE,
  parseSourceType,
  isStatusAccepted,
  matchPriorityTier,
  sortCandidates,
  selectOptimalSource
};
