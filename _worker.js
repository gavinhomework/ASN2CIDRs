const GH_NAME = 'ipverse';

function pickArrays(data) {
  const candidates = [
    data,
    data?.prefixes,
    data?.subnets,
  ];

  for (const obj of candidates) {
    if (!obj) continue;

    const ipv4 = Array.isArray(obj.ipv4) ? obj.ipv4 : [];
    const ipv6 = Array.isArray(obj.ipv6) ? obj.ipv6 : [];

    if (ipv4.length || ipv6.length) {
      return { ipv4, ipv6 };
    }
  }

  return { ipv4: [], ipv6: [] };
}

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;

      /* 根路径：返回访问者 IP */
      if (path === '/') {
        return new Response(
          request.headers.get('cf-connecting-ip') || '',
          { status: 200 }
        );
      }

      /* 提取 ASN */
      const match = path.match(/(\d{1,6})/);
      if (!match) {
        return new Response('"无效的 ASN"', { status: 400 });
      }
      const ASN = match[1];

      const ASN_URL =
        `https://raw.githubusercontent.com/${env.GH_NAME || GH_NAME}/asn-ip/refs/heads/master/as/${ASN}/aggregated.json`;

      /* Cache */
      const cacheKey = new Request(ASN_URL, request);
      const cache = caches.default;
      let resp = await cache.match(cacheKey);

      if (!resp) {
        resp = await fetch(ASN_URL, {
          cf: { cacheTtl: 3600, cacheEverything: true },
        });

        if (!resp.ok) {
          return new Response('"ASN 不存在"', { status: 404 });
        }

        ctx.waitUntil(cache.put(cacheKey, resp.clone()));
      }

      /* JSON */
      let data;
      try {
        data = await resp.json();
      } catch {
        return new Response('"JSON 解析失败"', { status: 502 });
      }

      /* ⭐ 结构自适应提取 ⭐ */
      const { ipv4, ipv6 } = pickArrays(data);

      if (!ipv4.length && !ipv6.length) {
        return new Response('"ASN 无可用前缀"', { status: 404 });
      }

      /* JSON 原样输出 */
      if (path.endsWith('.json')) {
        return new Response(JSON.stringify(data, null, 2), {
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }

      /* 参数 */
      const want4 = url.searchParams.has('4');
      const want6 = url.searchParams.has('6');
      const wantAll = url.searchParams.has('all');

      let text = '';

      if (wantAll || (want4 && want6)) {
        text = [...ipv4, ...ipv6].join('\n');
      } else if (want6) {
        text = ipv6.join('\n');
      } else if (want4) {
        text = ipv4.join('\n');
      } else {
        /* 默认：有 IPv4 用 IPv4，否则 IPv6 */
        text = ipv4.length ? ipv4.join('\n') : ipv6.join('\n');
      }

      return new Response(text, {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });

    } catch (e) {
      console.log('Fatal:', e);
      return new Response('"Worker 内部错误"', { status: 500 });
    }
  },
};
