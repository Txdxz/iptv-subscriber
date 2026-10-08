const https = require('https');
const http = require('http');
const { execFile } = require('child_process');
const { URL } = require('url');
const { generatePaerToken } = require('./token');

class IptvClient {
  constructor(config = {}) {
    this.baseUrl = config.base_url || 'https://iptv.cqshushu.com';
    this.indexPath = config.index_path || '/index.php';
    this.timeoutMs = config.request_timeout_ms || 15000;
    this.userAgent = config.user_agent || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
  }

  async _request(requestUrl, options = {}) {
    const parsedUrl = new URL(requestUrl, this.baseUrl);
    const token = generatePaerToken();
    const headers = {
      'User-Agent': this.userAgent,
      'Referer': `${this.baseUrl}${this.indexPath}`,
      'Accept': options.isJson ? 'application/json, text/javascript, */*; q=0.01' : '*/*',
      'X-Requested-With': 'XMLHttpRequest',
      'X-CSRF-TOKEN': token,
      ...(options.headers || {})
    };

    try {
      return await this._nativeRequest(parsedUrl, headers, options);
    } catch (nativeErr) {
      if (nativeErr.code === 'ENOTFOUND' || nativeErr.message.includes('getaddrinfo') || nativeErr.message.includes('ECONNREFUSED')) {
        return await this._curlRequest(parsedUrl.href, headers, options);
      }
      throw nativeErr;
    }
  }

  _nativeRequest(parsedUrl, headers, options) {
    const isHttps = parsedUrl.protocol === 'https:';
    const requester = isHttps ? https : http;

    return new Promise((resolve, reject) => {
      const req = requester.request(parsedUrl, {
        method: options.method || 'GET',
        headers,
        timeout: options.timeout || this.timeoutMs
      }, (res) => {
        let chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          const body = buffer.toString('utf8');

          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({
              statusCode: res.statusCode,
              headers: res.headers,
              body
            });
          } else {
            reject(new Error(`HTTP ${res.statusCode} from ${parsedUrl.pathname}: ${body.substring(0, 200)}`));
          }
        });
      });

      req.on('timeout', () => {
        req.destroy(new Error(`Request to ${parsedUrl.href} timed out after ${this.timeoutMs}ms`));
      });

      req.on('error', (err) => {
        reject(err);
      });

      req.end();
    });
  }

  _curlRequest(targetUrl, headers, options) {
    return new Promise((resolve, reject) => {
      const statusMarker = '---HTTP_STATUS:';
      const args = [
        '-s',
        '-w', `\n${statusMarker}%{http_code}---`,
        '-m', String(Math.floor(this.timeoutMs / 1000))
      ];

      for (const [key, value] of Object.entries(headers)) {
        args.push('-H', `${key}: ${value}`);
      }
      args.push(targetUrl);

      execFile('curl', args, { maxBuffer: 15 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) {
          return reject(new Error(`curl request failed: ${err.message}`));
        }

        const markerIdx = stdout.lastIndexOf(`\n${statusMarker}`);
        if (markerIdx === -1) {
          return resolve({ statusCode: 200, body: stdout });
        }

        const body = stdout.substring(0, markerIdx);
        const markerPart = stdout.substring(markerIdx + statusMarker.length + 1);
        const codeMatch = markerPart.match(/^(\d+)---/);
        const statusCode = codeMatch ? parseInt(codeMatch[1], 10) : 200;

        if (statusCode >= 200 && statusCode < 300) {
          resolve({ statusCode, body });
        } else {
          reject(new Error(`HTTP ${statusCode} (via curl): ${body.substring(0, 200)}`));
        }
      });
    });
  }

  async fetchSourceList({ province = 'all', type = 'all', limit = 10, page = 1 } = {}) {
    const searchParams = new URLSearchParams({
      t: type,
      province,
      limit: String(limit),
      page: String(page)
    });

    const targetUrl = `${this.baseUrl}${this.indexPath}?${searchParams.toString()}`;
    const response = await this._request(targetUrl, { isJson: true });

    let data;
    try {
      data = JSON.parse(response.body);
    } catch (e) {
      throw new Error(`Failed to parse JSON list response: ${e.message}, body preview: ${response.body.substring(0, 150)}`);
    }

    if (data.status !== 'success') {
      throw new Error(`Site returned error status: ${data.message || data.status || 'unknown'}`);
    }

    const html = data.html || '';
    const sources = this._parseTableRows(html);
    const pagination = this._parsePagination(html, page);

    return {
      sources,
      pagination,
      title: data.title
    };
  }

  _parseTableRows(html) {
    const sources = [];
    const rows = html.match(/<tr[\s\S]*?<\/tr>/g) || [];

    for (const row of rows) {
      if (row.includes('<th>')) continue;

      const ipMatch = row.match(/class=["']ip-link["'][^>]*>\s*([0-9.]+)/);
      const onclickMatch = row.match(/onclick=["']gotoIP\(['"]([^'"]+)['"],\s*['"]([^'"]+)['"]\)/);
      const countMatch = row.match(/<td data-label=["']节目数:['"]><strong[^>]*>([0-9]+)<\/strong>/);
      const typeMatch = row.match(/<td data-label=["']类型:['"]>\s*([^<]+?)\s*<\/td>/);
      const onlineTimeMatch = row.match(/<td data-label=["']上线时间:['"]>\s*([^<]+?)\s*<\/td>/);
      const updateTimeMatch = row.match(/<td data-label=["']更新时间:['"]>\s*([^<]+?)\s*<\/td>/);
      const statusMatch = row.match(/<td data-label=["']状态:['"]>[\s\S]*?<span[^>]*class=["']status-badge[^"']*["'][^>]*>\s*([^<]+?)\s*<\/span>/);

      if (ipMatch && onclickMatch) {
        sources.push({
          ip: ipMatch[1].trim(),
          p: onclickMatch[1].trim(),
          t: onclickMatch[2].trim(),
          count: countMatch ? parseInt(countMatch[1].trim(), 10) : 0,
          type: typeMatch ? typeMatch[1].trim() : '',
          online_time: onlineTimeMatch ? onlineTimeMatch[1].trim() : '',
          update_time: updateTimeMatch ? updateTimeMatch[1].trim() : '',
          status: statusMatch ? statusMatch[1].trim() : '未知'
        });
      }
    }

    return sources;
  }

  _parsePagination(html, currentPage) {
    const hasNextPage = html.includes('class="pagination-btn">下一页</a>') || html.includes(`page=${currentPage + 1}`);
    const pageMatches = html.match(/page=(\d+)/g) || [];
    let maxPage = currentPage;
    for (const m of pageMatches) {
      const num = parseInt(m.replace('page=', ''), 10);
      if (num > maxPage) maxPage = num;
    }
    return {
      current_page: currentPage,
      max_page: maxPage,
      has_next_page: hasNextPage
    };
  }

  async fetchSourceDetail(p, t) {
    const targetUrl = `${this.baseUrl}${this.indexPath}?p=${encodeURIComponent(p)}&t=${encodeURIComponent(t)}`;
    const response = await this._request(targetUrl, { isJson: true });

    let data;
    try {
      data = JSON.parse(response.body);
    } catch (e) {
      throw new Error(`Failed to parse JSON detail response: ${e.message}`);
    }

    const html = data.html || '';
    const match = html.match(/\?s=([^&'"]+)&t=([^&'"]+)/);
    if (!match) {
      throw new Error(`Channel list parameter 's' not found in detail page for p=${p}`);
    }

    const sParam = match[1];
    const tParam = match[2];

    const statusMatch = html.match(/<span class=["']status-badge[^"']*["']>\s*([^<]+?)\s*<\/span>/);
    const status = statusMatch ? statusMatch[1].trim() : null;

    return {
      s: sParam,
      t: tParam,
      status,
      html
    };
  }

  async fetchM3UContent(s, t) {
    const targetUrl = `${this.baseUrl}${this.indexPath}?s=${encodeURIComponent(s)}&t=${encodeURIComponent(t)}&channels=1&format=m3u`;
    const response = await this._request(targetUrl, { isJson: false });
    return response.body;
  }

  async checkSourceStillAlive(p, t) {
    try {
      const detail = await this.fetchSourceDetail(p, t);
      if (!detail.status) return false;
      if (detail.status === '暂时失效') return false;
      const isAlive = detail.status === '新上线' || /^存活\d+天$/.test(detail.status);
      return { isAlive, status: detail.status, s: detail.s, t: detail.t };
    } catch (e) {
      return { isAlive: false, error: e.message };
    }
  }
}

module.exports = IptvClient;
