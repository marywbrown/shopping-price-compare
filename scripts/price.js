#!/usr/bin/env node
/**
 * shengsheng-price — 全网商品比价
 *
 * 数据源（与省省小程序一致）：
 *   - quotaApi多平台 (zhetaoke-multi)：
 *       京东   open_jing_union_open_goods_query.ashx  （需 ZHETAOKE_JD_UNION_ID）
 *       唯品会 open_vip_queryWithOauth.ashx           （需 ZHETAOKE_VIP_SID）
 *       拼多多 open_pdd_goods_detail_search_new.ashx  （需 PDD_APP_KEY/SECRET/PID，未开通会提示）
 *   - quotaApi淘宝全网搜 (zhetaoke quanwang)：淘宝（item_url 即带***的***详情页链接）
 *   - shortVideoApi (haodanku)：抖音、快手（quotaApi无此端点；搜索结果已带 PC 网页版 detail_url）
 *
 * 每个结果只附带：
 *   - itemUrl  商品链接（PC 网页版，淘宝/京东/唯品会带******参数）
 *
 * 字段命名说明：旧版曾用 promoUrl / promoTpwd，现统一为 itemUrl / itemTpwd。
 * 不再输出口令，统一只用链接；对外称"商品链接 / 推荐商品"。
 *
 * 密钥已内置香蕉的 key；使用者可用同名环境变量覆盖。
 *
 * 用法：
 *   node price.js --keyword 抽纸 --source all
 *   node price.js --keyword iPhone --source jd
 *   node price.js --keyword 耳机 --source vip --has-coupon 1
 * source: taobao|jd|vip|pdd|douyin|kuaishou|all（默认 all）
 */
const https = require('https');
const http = require('http');
const querystring = require('querystring');
const fs = require('fs');
const path = require('path');

const ZHETAOKE_APPKEY = process.env.ZHETAOKE_APPKEY || '';
const ZHETAOKE_SID = process.env.ZHETAOKE_SID || '';
const ZHETAOKE_VIP_SID = process.env.ZHETAOKE_VIP_SID || '';
const ZHETAOKE_JD_UNION_ID = process.env.ZHETAOKE_JD_UNION_ID || '';
const ZHETAOKE_PID = process.env.ZHETAOKE_PID || '';
const HAODANKU_APIKEY = process.env.HAODANKU_APIKEY || '';
const PDD_APP_KEY = process.env.PDD_APP_KEY || '';
const PDD_APP_SECRET = process.env.PDD_APP_SECRET || '';
const PDD_PID = process.env.PDD_PID || '';

const ZHETAOKE_BASE = 'https://api.zhetaoke.com:10001/api';
const HAODANKU_BASE = 'https://v3.api.haodanku.com';

// 发布用：填你部署的代理服务地址（headless-api 统一后端，比价走 ecommerce 域）。

// 本文件因此可以不包含任何明文 key（用 build_public.cjs 发布时清空）。
const DEFAULT_PROXY_BASE = 'https://cloudbase-d0grtsz3j7737094c-1454004821.ap-shanghai.app.tcloudbase.com/headless-api';

const DEFAULT_PROXY_TOKEN = '';

const PLATFORM_NAMES = { taobao: '淘宝', jd: '京东', vip: '唯品会', pdd: '拼多多', douyin: '抖音', kuaishou: '快手' };
const ALL_SOURCES = ['taobao', 'jd', 'vip', 'pdd', 'douyin', 'kuaishou'];

// ---------------------------------------------------------------------------
// 通用 HTTP（GET / POST，JSON）
// ---------------------------------------------------------------------------
function requestJson(urlStr, params, method, attempt = 0) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const lib = url.protocol === 'http:' ? http : https;
    let body = null;
    const headers = {};
    if (method === 'POST') {
      body = querystring.stringify(params || {});
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      headers['Content-Length'] = Buffer.byteLength(body);
    } else if (params) {
      Object.keys(params).forEach((k) => { const v = params[k]; if (v !== '' && v != null) url.searchParams.set(k, String(v)); });
    }
    const retry = (err) => {
      if (attempt < 1) return setTimeout(() => requestJson(urlStr, params, method, attempt + 1).then(resolve, reject), 300);
      reject(err);
    };
    const req = lib.request(url, { method: method || 'GET', timeout: 12000, headers }, (res) => {
      let body = ''; res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return retry(new Error('HTTP ' + res.statusCode));
        try { resolve(JSON.parse(body)); } catch (_) { retry(new Error('响应暂不可用')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('请求超时')));
    req.on('error', retry);
    if (body) req.write(body);
    req.end();
  });
}
const requestGetJson = (url, params) => requestJson(url, params, 'GET');
const requestPostJson = (url, params) => requestJson(url, params, 'POST');

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function completeUrl(url) {
  if (!url) return '';
  if (/^https?:\/\//.test(url)) return url;
  if (url.startsWith('//')) return 'https:' + url;
  return 'https://' + String(url).replace(/^\/\//, '');
}

// ---------------------------------------------------------------------------
// quotaApi · 淘宝全网搜（api_quanwang）
// ---------------------------------------------------------------------------
async function searchByOpenApi(keyword, opts) {
  if (!ZHETAOKE_SID || !ZHETAOKE_PID) throw new Error('quotaApi淘宝需 ZHETAOKE_SID 与 ZHETAOKE_PID');
  const params = {
    appkey: ZHETAOKE_APPKEY, sid: ZHETAOKE_SID, pid: ZHETAOKE_PID,
    q: String(keyword).trim(), page: String(opts.page || 1),
    page_size: String(Math.min(opts.pageSize || 20, 50)),
    type: '2',
  };
  // sort 从 opts.sort 透传（语义名 → 淘宝原生值）；default/undefined 不传 → 用平台综合默认排序
  const tbSort = { sales: 'sale_num_desc', price_asc: 'price_asc', price_desc: 'price_desc' }[opts.sort];
  if (tbSort) params.sort = tbSort;
  if (opts.hasCoupon) params.youquan = '1';
  if (opts.startPrice) params.start_price = String(opts.startPrice);
  if (opts.endPrice) params.end_price = String(opts.endPrice);
  const res = await requestGetJson('https://api.zhetaoke.com:10003/api/api_quanwang.ashx', params);
  if (num(res.status) !== 200) throw new Error(res.msg || res.content || 'quotaApi淘宝搜索失败');
  const rows = Array.isArray(res.content) ? res.content : [];
  return rows.map((it) => {
    const o = num(it.zk_final_price || it.size);
    const f = num(it.quanhou_jiage) || Math.max(0, o - num(it.coupon_amount || it.coupon_info_money));
    return {
      source: 'taobao', platform: '淘宝',
      goodsId: String(it.tao_id || it.num_iid || ''),
      title: String(it.tao_title || it.title || '').trim(),
      pictUrl: completeUrl(it.pict_url || ''),
      originalPrice: o, finalPrice: f,
      couponAmount: num(it.coupon_amount || it.coupon_info_money),
      couponInfo: num(it.coupon_amount) ? ('满' + num(it.coupon_start_fee) + '减' + num(it.coupon_amount)) : '',
      extra: num(it.tkfee3), rate: num(it.tkrate3),
      volume: num(it.volume || it.sellCount),
      shopTitle: String(it.shop_title || it.nick || '').trim(),
      // 详情字段：淘宝有店铺 DSR（评分）与三项分、评价数、品牌、类目、多图
      rating: num(it.shop_dsr || it.score1),            // 店铺综合评分（5 分制）
      scoreDescribe: num(it.score1),                    // 描述相符
      scoreService: num(it.score2),                     // 服务态度
      scoreLogistics: num(it.score3),                   // 物流服务
      commentCount: num(it.commentCount),               // 评价数（计数，无文字内容）
      brandName: String(it.pinpai_name || '').trim(),
      categoryName: String(it.category_name || '').trim(),
      images: (String(it.small_images || '').split('|').filter(Boolean)).concat(completeUrl(it.white_image || '') ? [completeUrl(it.white_image)] : []),

      itemUrl: completeUrl(it.item_url || ''),
      itemTpwd: '',
    };
  }).filter((x) => x.goodsId && x.title);
}

// ---------------------------------------------------------------------------
// quotaApi · 多平台（京东 / 唯品会 / 拼多多）
// ---------------------------------------------------------------------------
function unwrapJd(response) {
  let root = response && response.jd_union_open_goods_query_response;
  if (root && typeof root.result === 'string') { try { root = JSON.parse(root.result); } catch (_) { root = {}; } }
  else if (root && root.result) root = root.result;
  if (root && Array.isArray(root.data)) return root.data;
  if (root && typeof root.queryResult === 'string') { try { root = JSON.parse(root.queryResult); } catch (_) { root = {}; } }
  else if (root && root.queryResult) root = root.queryResult;
  const goods = root && root.data && root.data.goodsResp;
  if (Array.isArray(goods)) return goods;
  if (goods && Array.isArray(goods.goods)) return goods.goods;
  if (goods && goods.skuId) return [goods];
  if (Array.isArray(response && response.content)) return response.content;
  return [];
}

function normalizeJd(item) {
  const price = item.priceInfo || {};
  const purchase = item.purchasePriceInfo || {};
  const couponList = item.couponInfo && item.couponInfo.couponList;
  const coupons = Array.isArray(couponList) ? couponList : (couponList && couponList.coupon ? [couponList.coupon] : []);
  const coupon = coupons.find((x) => x && (x.isBest === '1' || x.isBest === 1)) || coupons[0] || {};
  const purchaseCoupons = Array.isArray(purchase.couponList) ? purchase.couponList : [];
  const purchaseCoupon = purchaseCoupons[0] || {};
  const listPrice = Number(price.price || item.size || 0);
  const lowestPrice = Number(price.lowestPrice || 0);
  const couponPrice = Number(price.lowestCouponPrice || item.quanhou_jiage || 0);
  const thresholdPrice = Number(purchase.thresholdPrice || 0);
  const purchasePrice = Number(purchase.purchasePrice || 0);
  let originalPrice = thresholdPrice || listPrice || lowestPrice || 0;
  let finalPrice = couponPrice || lowestPrice || listPrice || 0;
  if (purchasePrice > 0) {
    finalPrice = purchasePrice;
    if (thresholdPrice > purchasePrice) originalPrice = thresholdPrice;
    else if (listPrice > purchasePrice) originalPrice = listPrice;
  }
  const couponAmount = Number(purchaseCoupon.discount || coupon.discount || item.coupon_info_money || Math.max(0, (originalPrice || 0) - (finalPrice || 0)) || 0);
  let couponInfo = '';
  if (coupon.quota) couponInfo = '满' + coupon.quota + '减' + coupon.discount;
  else if (item.coupon_info) couponInfo = item.coupon_info;
  else if (purchasePrice > 0 && originalPrice > purchasePrice + 0.009) {
    const off = Math.round((1 - purchasePrice / originalPrice) * 1000) / 10;
    couponInfo = off >= 1 ? ('促销到手约省' + off + '%') : '含促销到手价';
  }
  const itemUrl = item.materialUrl || item.item_url || (item.skuId ? 'https://item.jd.com/' + item.skuId + '.html' : '');
  const images = (item.imageInfo && Array.isArray(item.imageInfo.imageList)) ? item.imageInfo.imageList.map((x) => x.url).filter(Boolean) : [];
  const shop = item.shopInfo || {};
  return {
    source: 'jd', platform: '京东',
    goodsId: String(item.skuId || item.itemId || ''),
    title: item.skuName || item.title || '',
    pictUrl: images[0] || (item.pict_url || ''),
    originalPrice, finalPrice, couponAmount, couponInfo,
    extra: Number((item.commissionInfo && item.commissionInfo.commission) || item.tkfee3 || 0),
    rate: Number((item.commissionInfo && item.commissionInfo.commissionShare) || item.tkrate3 || 0),
    itemUrl: completeUrl(itemUrl),
    itemTpwd: '',
    shopTitle: shop.shopName || item.shop_title || '',
    // 详情字段：京东有店铺等级、好评率、评价数、销量、类目、多图
    rating: num(shop.shopLevel),                        // 店铺等级（近似评分）
    goodCommentRate: num(item.goodCommentsShare),       // 好评率（%）
    commentCount: num(item.comments),                   // 评价数
    volume: num(item.inOrderCount30Days),               // 近 30 天销量
    categoryName: (item.categoryInfo && item.categoryInfo.cid3Name) || '',
    images,
  };
}

// 唯品会 destUrl 是手机版 m.vip.com/product-<brandId>-<goodsId>.html
// 改写成 PC 版 www.vip.com/detail-<brandId>-<goodsId>.html（301 → detail.vip.com 详情页）
function vipPcUrl(rawUrl) {
  if (!rawUrl) return '';
  return String(rawUrl).replace(/https?:\/\/m\.vip\.com\/product-(\d+)-(\d+)\.html/i, 'https://www.vip.com/detail-$1-$2.html');
}

function normalizeVip(item) {
  const carousel = Array.isArray(item.goodsCarouselPictures) ? item.goodsCarouselPictures : [];
  return {
    source: 'vip', platform: '唯品会',
    goodsId: String(item.goodsId || ''), title: item.goodsName || '',
    pictUrl: item.goodsThumbUrl || item.goodsMainPicture || carousel[0] || '',
    originalPrice: Number(item.marketPrice || 0), finalPrice: Number(item.vipPrice || item.estimatePrice || 0),
    couponAmount: 0, couponInfo: '',
    extra: Number(item.commission || 0), rate: Number(item.commissionRate || 0),
    itemUrl: item.destUrl || '',   // 唯品会 destUrl 本身就是手机版 m.vip.com，默认作为商品链接
    itemTpwd: '',
    shopTitle: item.brandName || '',            // 唯品会只有品牌名，无独立店铺名
    // 详情字段：销量、类目、轮播图（唯品会 API 不提供评分/评价数）
    volume: 0, salesText: String(item.productSales || ''),
    categoryName: item.categoryName || '',
    images: carousel,
    rating: 0, goodCommentRate: 0, commentCount: 0,
  };
}

function normalizePdd(item) {
  const originalPrice = Number(item.min_normal_price || item.min_group_price || 0) / 100;
  const couponAmount = Number(item.coupon_discount || 0) / 100;
  return {
    source: 'pdd', platform: '拼多多',
    goodsId: String(item.goods_id || ''), title: item.goods_name || item.goods_desc || '',
    pictUrl: item.goods_thumbnail_url || item.goods_image_url || '',
    originalPrice, finalPrice: Math.max(0, originalPrice - couponAmount),
    couponAmount, couponInfo: couponAmount ? '优惠券减' + couponAmount + '元' : '',
    extra: 0, rate: Number(item.promotion_rate || 0) / 10,
    itemUrl: '', itemTpwd: '',
    shopTitle: item.mall_name || '',
  };
}

function normalizeZhetaokeMulti(source, res) {
  if (source === 'jd') return unwrapJd(res).map(normalizeJd);
  if (source === 'vip') return (((res || {}).result || {}).goodsInfoList || []).map(normalizeVip);
  if (source === 'pdd') return ((((res || {}).goods_search_response || {}).goods_list) || []).map(normalizePdd);
  return [];
}

async function searchByOpenApiMulti(source, keyword, opts) {
  const params = { appkey: ZHETAOKE_APPKEY };
  let endpoint;
  if (source === 'jd') {
    if (!ZHETAOKE_JD_UNION_ID) throw new Error('京东需配置 ZHETAOKE_JD_UNION_ID');
    endpoint = ZHETAOKE_BASE + '/open_jing_union_open_goods_query.ashx';
    Object.assign(params, { keyword: String(keyword).trim(), pageIndex: opts.page || 1, pageSize: opts.pageSize || 20, unionId: ZHETAOKE_JD_UNION_ID, isCoupon: opts.hasCoupon ? '1' : '' });
  } else if (source === 'vip') {
    if (!ZHETAOKE_VIP_SID) throw new Error('唯品会需配置 ZHETAOKE_VIP_SID');
    endpoint = ZHETAOKE_BASE + '/open_vip_queryWithOauth.ashx';
    Object.assign(params, { sid: ZHETAOKE_VIP_SID, keyword: String(keyword).trim(), page: opts.page || 1, pageSize: opts.pageSize || 20 });
  } else if (source === 'pdd') {
    if (!PDD_APP_KEY || !PDD_APP_SECRET || !PDD_PID) throw new Error('拼多多需 PDD_APP_KEY/SECRET/PID（当前未配置）');
    endpoint = ZHETAOKE_BASE + '/open_pdd_goods_detail_search_new.ashx';
    // sort_type 从 opts.sort 映射：default→0(综合) / sales→1(销量) / price_asc→2 / price_desc→3
    const pddSort = { default: 0, sales: 1, price_asc: 2, price_desc: 3 }[opts.sort || 'default'] ?? 0;
    Object.assign(params, { pdd_app_key: PDD_APP_KEY, pdd_app_secret: PDD_APP_SECRET, pid: PDD_PID, keyword: String(keyword).trim(), with_coupon: opts.hasCoupon ? 'true' : 'false', sort_type: pddSort });
  } else {
    throw new Error('quotaApi不支持平台: ' + source);
  }
  const res = await requestGetJson(endpoint, params);
  if (source === 'jd' && res && Number(res.status) === 301) throw new Error('京东：' + (res.content || res.msg || '请求失败'));
  if (source === 'vip' && String(res && res.returnCode || '0') !== '0') throw new Error('唯品会：' + (res.returnMessage || res.returnCode));
  return normalizeZhetaokeMulti(source, res).filter((x) => x.goodsId && x.title);
}

// ---------------------------------------------------------------------------
// shortVideoApi · 抖音 / 快手（quotaApi无此端点）
// ---------------------------------------------------------------------------
const HAODANKU_PATHS = { douyin: '/dy_itemlist_simplify', kuaishou: '/ks_item_list' };

// 抖音：搜索返回的 detail_url 就是 PC 网页版（haohuo.jinritemai.com/ecommerce/trade/detail/index.html?id=xxx）
function douyinPcUrl(detailUrl, productId) {
  const u = completeUrl(detailUrl || '');
  if (u) return u;
  return productId ? 'https://haohuo.jinritemai.com/ecommerce/trade/detail/index.html?id=' + productId : '';
}

// 快手：shortVideoApi返回的 detail_url 走 ac31.suvmothq.com 跟踪域名，该子域已失效（DNS 解析不到，链接打不开）。
// 一律改用快手官方商品页兜底（app.kwaixiaodian.com/web/kwaishop-goods-detail-page-app?id=...），保证能打开

function kuaishouPcUrl(detailUrl, productId) {
  const u = completeUrl(detailUrl || '');
  if (u && !/suvmothq\.com/i.test(u)) return u; // 仅在非失效域名时才用 API 给的链接
  return productId ? 'https://app.kwaixiaodian.com/web/kwaishop-goods-detail-page-app?id=' + productId : '';
}

function normalizeHaodanku(source, it) {
  const o = num(it.itemprice || it.marketPrice || it.price);
  const f = num(it.itemendprice || it.vipPrice || it.end_price || it.finalPrice) || o;
  const ca = num(it.couponmoney || it.coupon_amount || it.discount);
  const productId = String(it.product_id || it.itemid || it.goodsId || it.goods_id || it.skuId || '');
  const itemUrl = source === 'douyin'
    ? douyinPcUrl(it.detail_url || '', productId)
    : kuaishouPcUrl(it.detail_url || '', productId);
  return {
    source, platform: PLATFORM_NAMES[source] || source,
    goodsId: productId,
    title: String(it.itemtitle || it.goodsname || it.goodsName || it.product_title || it.title || '').trim(),
    pictUrl: completeUrl(it.itempic || it.goodsMainPicture || it.item_pic || ''),
    originalPrice: o, finalPrice: f, couponAmount: ca,
    couponInfo: ca ? '券减' + ca + '元' : '',
    extra: num(it.tkmoney || it.jdmoney || it.commission || it.dymoney || it.ksmoney),
    volume: num(it.itemsale || it.productSales || it.sales),
    shopTitle: String(it.shopname || it.shop_name || it.brandName || it.brand_name || '').trim(),
    itemUrl,
    itemTpwd: '',
    // 详情字段：抖音/快手 API 不提供评分、评价数；仅有销量与店铺名
    rating: 0, goodCommentRate: 0, commentCount: 0,
    categoryName: String(it.category_name || ''),
    images: [completeUrl(it.itempic || it.goodsMainPicture || it.item_pic || '')],
  };
}
async function searchByShortVideoApi(source, keyword, opts) {
  const params = { apikey: HAODANKU_APIKEY, keyword: String(keyword).trim(), min_id: opts.page || 1 };
  const want = Math.max(1, opts.pageSize || 20);
  // shortVideoApi back 仅支持 10 / 50；want>10 取 50，否则取 10（保证能拿到 20 条）
  params.back = want > 10 ? 50 : 10;
  const res = await requestGetJson(HAODANKU_BASE + HAODANKU_PATHS[source], params);
  if (num(res.code) !== 200 && num(res.code) !== 1) throw new Error(res.msg || (PLATFORM_NAMES[source] + '搜索失败'));
  const rows = Array.isArray(res.data) ? res.data : (res.data ? [res.data] : []);
  return rows.map((it) => normalizeHaodanku(source, it)).filter((x) => x.goodsId && x.title);
}

// 给单条结果补商品链接（淘宝/京东/唯品会/抖音/快手均已在搜索阶段拿到 PC 版 URL；本函数保留以备未来兜底）
async function attachPromo(item) {
  return item;
}

// ---------------------------------------------------------------------------









// ---------------------------------------------------------------------------
const ZHETAOKE_JD_POSITION_ID = process.env.ZHETAOKE_JD_POSITION_ID || ''; // 京东自定义推广位（数字），订单透出，可选

//   京东：POST + byunionid（:20000 端口）→ 优先 shortURL 京东短链（chainType=2 数字，60天有效）

//         失败自动重试 2 次（共 3 次）；全部失败抛异常，由调用方决定是否兜底
async function ztkConvertByUnionId(link, source, channel) {
  if (source === 'jd') {
    const params = {
      appkey: ZHETAOKE_APPKEY, materialId: link, unionId: ZHETAOKE_JD_UNION_ID,
      chainType: 2, signurl: '0',
    };
    if (channel) params.channelId = String(channel).slice(0, 80);

    const MAX_RETRIES = 2;
    let lastError;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await requestPostJson('http://api.zhetaoke.com:20000/api/open_jing_union_open_promotion_byunionid_get.ashx', params);
        const root = res && res.jd_union_open_promotion_byunionid_get_response;
        if (!root) throw new Error('京东链接响应异常');
        let result = root.result || '';
        if (typeof result === 'string') { try { result = JSON.parse(result); } catch (_) { result = {}; } }
        const short = result && result.data && result.data.shortURL;
        if (!short) throw new Error('京东链接未返回短链');
        return completeUrl(short);
      } catch (e) {
        lastError = e;
        if (attempt < MAX_RETRIES) continue;
        throw lastError;
      }
    }
  }
  if (source === 'vip') {
    const params = { appkey: ZHETAOKE_APPKEY, sid: ZHETAOKE_VIP_SID, url: link };
    if (channel) params.statParam = String(channel).slice(0, 256);
    const res = await requestGetJson('https://api.zhetaoke.com:10001/api/open_vip_genByVIPUrlWithOauth.ashx', params);
    if (String(res && res.returnCode) !== '0') throw new Error('唯品会链接失败');
    const list = (res && res.result && res.result.urlInfoList) || [];
    const short = list[0] && (list[0].url || list[0].noEvokeUrl || '');
    if (!short) throw new Error('唯品会链接未返回短链');
    return completeUrl(short);
  }
  throw new Error('不支持的链接平台: ' + source);
}



//   - douyin → 抖音短链（好单库 channel）
//   - kuaishou → 快手短链（好单库 channel）

async function applyPromoLinks(items, source, channel) {
  const ch = String(channel || process.env.HAODANKU_DY_CHANNEL || 'scc').trim(); // 默认 scc=skill 默认渠道
  if (source === 'douyin' || source === 'kuaishou') {
    const withId = items.filter((it) => it.goodsId);
    for (const it of withId) {
      try {
        const link = source === 'douyin'
          ? await haodankuDyConvert(it.goodsId, ch)
          : await haodankuKsConvert(it.goodsId, ch);
        it.itemUrl = link; it.pcUrl = link; it.converted = true;
      } catch (e) {
        // 下架/失效商品：不再给链接；其余错误（网络/限流）保留原链接
        if (/下架|失效|不存在/.test(e.message || '')) { it.itemUrl = ''; it.itemError = '商品已下架'; }
      }
    }
    return items;
  }
  if (source !== 'jd' && source !== 'vip') return items; // 淘宝已有***
  const withLink = items.filter((it) => it.itemUrl);
  if (!withLink.length) return items;
  const originals = withLink.map((it) => completeUrl(it.itemUrl));
  const map = {};
  const CONCURRENCY = 5;
  for (let i = 0; i < originals.length; i += CONCURRENCY) {
    const chunk = originals.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(async (u) => {
      try { map[u] = await ztkConvertByUnionId(u, source, ch); } catch (e) {
        // 京东链接全部重试失败：保留搜索阶段 materialUrl 作为最后兜底 + 告警
        if (source === 'jd') {
          console.error('[WARN] 京东链接3次均失败，该链接未带我们的unionId，可能不计收益:', u, e.message);
          map[u] = null; // 标记为未转换，后面保留原链
        }
        /* vip 失败保留原链 */
      }
    }));
  }
  withLink.forEach((it, i) => {
    const short = map[originals[i]];
    if (short) { it.itemUrl = short; it.pcUrl = short; it.converted = true; }
  });
  return items;
}

// 好单库 抖音商品链接：get_dyitem_link（每次一个 itemid，share_type=5 → 站外 H5 推广链接 抖音短链）
async function haodankuDyConvert(itemid, channel) {
  const params = { apikey: HAODANKU_APIKEY, itemid: String(itemid), share_type: '5' };
  if (channel) params.channel = String(channel).slice(0, 50);
  const res = await requestPostJson(HAODANKU_BASE + '/get_dyitem_link', params); // 注意：该接口仅支持 POST
  if (Number(res && res.code) !== 200) throw new Error((res && res.msg) || '抖音链接失败');
  const link = (res.data && res.data.share_link) || '';
  if (!link) throw new Error('抖音链接无 share_link');
  return completeUrl(link);
}

// 好单库 快手商品链接：ks_item_ratesurl（每次一个 product_id，POST）

// 老跟踪域 ac31.suvmothq.com 已失效，若返回该域则视为链接失败。
async function haodankuKsConvert(productId, channel) {
  const params = { apikey: HAODANKU_APIKEY, product_id: String(productId) };
  if (channel) params.channel = String(channel).slice(0, 10);
  const res = await requestPostJson(HAODANKU_BASE + '/ks_item_ratesurl', params); // 注意：该接口仅支持 POST
  if (Number(res && res.code) !== 200) throw new Error((res && res.msg) || '快手链接失败');
  const link = (res.data && res.data.linkUrl) || '';
  if (!link || /suvmothq\.com/i.test(link)) throw new Error('快手链接链接无效');
  return completeUrl(link);
}

// 设备适配：默认返回手机版链接（itemUrl），并附带 PC 版（pcUrl）

//           （会被京东风控页拦截→显示下架）。原始 itemUrl 已是 jingfen.jd.com/detail/<编码>.html，

//   - 唯品会：destUrl 已是手机版 m.vip.com，PC 版为 www.vip.com/detail-<brand>-<goods>.html
//   - 淘宝 / 抖音 / 快手：原链接移动端原生可用，pc 与 mobile 相同（快手统一走官方兜底域名）
// 默认 device=mobile → itemUrl 即手机版；仅当 device=desktop 时 itemUrl 才给 PC 版。
function applyDevice(item, device) {
  const src = item.source;
  const def = item.itemUrl || '';
  let mobile = def, pc = def;
  if (src === 'jd') {
    // 京东：保留原始 jingfen.jd.com/detail/<编码>.html（PC/手机通用、可正常打开）
    mobile = def; pc = def;
  } else if (src === 'vip') {
    const m = /product-(\d+)-(\d+)\.html/i.exec(def);
    if (m) { mobile = def; pc = 'https://www.vip.com/detail-' + m[1] + '-' + m[2] + '.html'; }
  }
  item.pcUrl = pc;
  item.itemUrl = (device === 'desktop') ? pc : mobile;
  return item;
}

// ---------------------------------------------------------------------------

// 而是把参数转发到用户自己的代理服务（cloudfunctions/shengsheng-price-proxy），

// ---------------------------------------------------------------------------
const TOKEN_FILE = path.join(__dirname, 'token.json');

// 自动注册：优先 env → 本地缓存 token.json → POST /register 现领 → 兜底旧 DEFAULT_PROXY_TOKEN（仅开发态）
async function ensureToken(base) {
  const envTok = process.env.SHENGSENG_PROXY_TOKEN;
  if (envTok) return envTok;
  try {
    const cached = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    if (cached && cached.token) return cached.token;
  } catch (_) {}
  try {
    const t = await registerToken(base);
    try { fs.writeFileSync(TOKEN_FILE, JSON.stringify({ token: t, createdAt: Date.now() })); } catch (_) {}
    return t;
  } catch (e) {
    if (DEFAULT_PROXY_TOKEN) return DEFAULT_PROXY_TOKEN; // 开发态兜底（发布包已清空）
    throw e;
  }
}

function registerToken(base) {
  return new Promise((resolve, reject) => {
    const root = String(base || '').replace(/\/+$/, '');
    const regUrl = root + '/register';
    const u = new URL(regUrl);
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request(u, { method: 'POST', timeout: 20000, headers: { 'Content-Type': 'application/json' } }, (res) => {
      let body = ''; res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try {
          const j = JSON.parse(body);
          if (j && j.token) resolve(j.token);
          else reject(new Error((j && j.error) || '注册失败'));
        } catch (_) { reject(new Error('注册响应解析失败')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('注册超时')));
    req.on('error', reject);
    req.end();
  });
}

function runProxyOnce(p, base, token) {
  return new Promise((resolve, reject) => {
    const root = String(base || '').replace(/\/+$/, '');
    const q = new URLSearchParams();
    if (p.keyword) q.set('keyword', p.keyword);
    if (p.source) q.set('source', p.source);
    if (p.detail) q.set('detail', '1');
    if (p.pageSize) q.set('pageSize', p.pageSize);
    if (p.limit) q.set('limit', p.limit);
    if (p.page) q.set('page', p.page);
    if (p['has-coupon']) q.set('hasCoupon', p['has-coupon']);
    if (p['start-price']) q.set('start-price', p['start-price']);
    if (p['end-price']) q.set('end-price', p['end-price']);
    if (p.device) q.set('device', p.device);
    if (token) q.set('token', token);
    // 统一网关（headless-api）按"路径最后一段=action"路由：
    //   - 比价走 /priceSearch（ecommerce 域；注意 'search' 被网关留给 coupons 域小程序语义）
    //   - 旧代理（shengsheng-price-proxy）对非 /register 路径也一律当比价，兼容两种。
    const sep = root.includes('?') ? '&' : '?';
    const url = root + '/priceSearch' + sep + q.toString();
    const u = new URL(url);
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.get(u, { timeout: 20000 }, (res) => {
      let body = ''; res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve(body));
    });
    req.on('timeout', () => req.destroy(new Error('代理请求超时')));
    req.on('error', reject);
  });
}

// 自动注册 + 401（token 失效，如密钥轮换）自动清缓存重注册一次
async function runProxy(p, base) {
  const token = await ensureToken(base);
  let raw = await runProxyOnce(p, base, token);
  let parsed;
  try { parsed = JSON.parse(raw); } catch (_) {}
  if (parsed && parsed.code === 401) {
    try { fs.unlinkSync(TOKEN_FILE); } catch (_) {}
    const token2 = await ensureToken(base);
    raw = await runProxyOnce(p, base, token2);
  }
  return raw;
}

// ---------------------------------------------------------------------------
// 路由
// ---------------------------------------------------------------------------
async function searchBySource(source, keyword, opts) {
  if (source === 'taobao') return searchByOpenApi(keyword, opts);
  if (source === 'jd' || source === 'vip' || source === 'pdd') return searchByOpenApiMulti(source, keyword, opts);
  if (source === 'douyin' || source === 'kuaishou') return searchByShortVideoApi(source, keyword, opts);
  throw new Error('不支持的平台: ' + source);
}

// 单品详情：按关键词在指定平台搜索，返回首个命中商品的全部字段
async function getDetail(sources, keyword, opts) {
  const warnings = [];
  const device = (opts && opts.device === 'desktop') ? 'desktop' : 'mobile';
  for (const s of sources) {
    try {
      const r = await searchBySource(s, keyword, Object.assign({ page: 1, pageSize: 5 }, opts));
      if (r.length) {
        const detail = r[0];
        const converted = await applyPromoLinks([detail], s, opts.channel);
        applyDevice(converted[0], device);
        return { source: s, platform: PLATFORM_NAMES[s], detail: converted[0], warnings };
      }
    } catch (e) { warnings.push(PLATFORM_NAMES[s] + '：' + e.message); }
  }
  return { detail: null, warnings };
}

async function main() {
  const argv = process.argv.slice(2);
  const p = {}; let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a === '--keyword') { p.keyword = argv[++i]; }
    else if (a.startsWith('--')) {
      const key = a.slice(2);
      const nxt = argv[i + 1];
      if (nxt !== undefined && !nxt.startsWith('--')) p[key] = argv[++i]; // 取值标志
      else p[key] = true;                                                 // 布尔标志（如 --detail）
    }
    i++;
  }
  const keyword = (p.keyword || '').trim();
  if (!keyword) return console.log(JSON.stringify({ error: '缺少 --keyword' }));

  const proxyBase = process.env.SHENGSENG_API_BASE || DEFAULT_PROXY_BASE;
  if (proxyBase) {
    try {
      const raw = await runProxy(p, proxyBase);
      process.stdout.write(raw);
    } catch (e) {
      console.log(JSON.stringify({ error: '代理请求失败: ' + e.message }));
    }
    return;
  }

  const source = (p.source || 'all').toLowerCase();
  const opts = { page: p.page ? Number(p.page) : 1, pageSize: p.pageSize ? Number(p.pageSize) : 20, sort: p.sort, hasCoupon: p['has-coupon'], startPrice: p['start-price'], endPrice: p['end-price'], device: p.device === 'desktop' ? 'desktop' : 'mobile', channel: p.channel };

  // 详情模式：返回单品完整信息（价格/店铺/评分/评价数/销量/图片等）
  if (p.detail) {
    const targets = source === 'all' ? ALL_SOURCES : String(source).split(',').map((s) => s.trim()).filter(Boolean);
    const d = await getDetail(targets, keyword, opts);
    const out = d.detail ? { detail: d.detail } : { error: '未找到该商品', keyword };
    if (d.warnings.length) out.warnings = d.warnings;
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  let results = [];
  const warnings = [];
  const fail = (s, e) => warnings.push(PLATFORM_NAMES[s] + '：' + e.message);

  const targets = source === 'all' ? ALL_SOURCES : String(source).split(',').map((s) => s.trim()).filter(Boolean);
  if (targets.length === 0) return console.log(JSON.stringify({ error: '无效的 source: ' + source }));
  if (targets.length === 1) {
    try { results = results.concat(await searchBySource(targets[0], keyword, opts)); }
    catch (e) { fail(targets[0], e); }
  } else {
    const settled = await Promise.allSettled(targets.map((s) => searchBySource(s, keyword, opts)));
    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') results = results.concat(result.value);
      else fail(targets[index], result.reason || new Error('暂时无法查询'));
    });
  }

  // 合并后排序：
  //   default   → 多平台轮询混排（淘宝 1 → 京东 1 → 抖音 1 → 唯品会 1 → 拼多多 1 → 快手 1 → 淘宝 2 → ...）
  //                保证默认 limit=20 的前 20 条覆盖 ≥4 个平台（不再让淘宝一个平台霸榜）
  //   price_asc → 按到手价升序
  //   sales     → 按销量降序

  const sortMode = opts.sort || 'default';
  if (sortMode === 'price_asc') results.sort((a, b) => (a.finalPrice || 1e9) - (b.finalPrice || 1e9));
  else if (sortMode === 'price_desc') results.sort((a, b) => (b.finalPrice || 0) - (a.finalPrice || 0));
  else if (sortMode === 'sales') results.sort((a, b) => (b.volume || 0) - (a.volume || 0));
  else if (sortMode === 'extra') results.sort((a, b) => (b.rate || 0) - (a.rate || 0));
  else {
    // default：按 source 分桶，再按各桶内原顺序（接口默认排序），然后轮询每桶 1 条
    const buckets = new Map();
    for (const it of results) {
      if (!buckets.has(it.source)) buckets.set(it.source, []);
      buckets.get(it.source).push(it);
    }
    const sources = Array.from(buckets.keys()).sort(); // 稳定顺序：拼音字典序，避免乱跳
    const queued = [];
    let appended = true;
    while (appended) {
      appended = false;
      for (const s of sources) {
        const b = buckets.get(s);
        if (b && b.length) { queued.push(b.shift()); appended = true; }
      }
    }
    results = queued;
  }
  const limit = Number(p.limit || 20);
  const pick = results.slice(0, limit);

  for (const src of ['jd', 'vip', 'douyin', 'kuaishou']) {
    const idx = pick.map((it, i) => (it.source === src ? i : -1)).filter((i) => i >= 0);
    if (idx.length) {
      const converted = await applyPromoLinks(idx.map((i) => pick[i]), src, opts.channel);
      converted.forEach((it, k) => { pick[idx[k]] = it; });
    }
  }
  // 链接按设备适配：默认手机版 itemUrl，并附 pcUrl（仅用户明确要电脑时用）
  for (const it of pick) applyDevice(it, opts.device);
  for (const it of pick) if (!it.itemUrl) it.itemError = '该商品未取到商品链接';

  const out = {
    keyword, platformCount: new Set(results.map((r) => r.source)).size, total: results.length,
    top: pick[0] || null, list: pick,
    priceNote: '接口返回的是券后到手价，还不含国家补贴（国补）。京东、淘宝、唯品会等多数平台都参与国补（数码类常见 15%、家电最高 20%，需实名+地区+到页面领资格）、平台补贴、秒杀、店铺活动等，最终成交价以点开页面为准。',
  };
  if (warnings.length && results.length === 0) out.error = '暂时没查到合适的商品，请稍后再试或换个说法';
  // warnings 仅供宿主 Agent 做内部诊断，不输出给终端用户。
  console.log(JSON.stringify(out, null, 2));
}
if (require.main === module) main();
module.exports = { searchBySource, searchByOpenApi, searchByOpenApiMulti, searchByShortVideoApi, vipPcUrl, douyinPcUrl, kuaishouPcUrl, applyDevice, applyPromoLinks, ztkConvertByUnionId, haodankuDyConvert, haodankuKsConvert, getDetail };
