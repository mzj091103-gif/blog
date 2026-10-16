(function (root) {
  'use strict';
  const STAGES = ['新询盘', '已联系', '已报价', '已寄样', '谈判中', '已成交', '已流失'];
  const SOURCES = ['Alibaba', 'Google', 'Facebook', 'TikTok', 'Website'];
  const FIELDS = ['name', 'country', 'source', 'product', 'contact', 'stage', 'owner', 'lastContact', 'nextFollowUp', 'notes'];
  const normalize = value => String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  function localDate(date = new Date(), zone = 'Asia/Shanghai') {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date).map(x => [x.type, x.value]));
    return `${p.year.padStart(4, '0')}-${p.month}-${p.day}`;
  }
  function validDate(value) {
    if (typeof value !== 'string' || value.length !== 10) return false;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!m) return false;
    const y = +m[1], month = +m[2], d = +m[3];
    const days = [31, y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return y > 0 && month >= 1 && month <= 12 && d >= 1 && d <= days[month - 1];
  }
  function clean(values) {
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('客户信息格式错误。');
    if (Object.keys(values).some(key => !FIELDS.includes(key))) throw new Error('客户信息包含不支持的字段。');
    const result = {};
    for (const key of FIELDS) {
      if (typeof values[key] !== 'string') throw new Error(`客户字段 ${key} 必须是文本。`);
      result[key] = values[key].trim();
    }
    return result;
  }
  function validate(c, { today = localDate() } = {}) {
    for (const [key, label, max] of [['name', '客户名称', 120], ['country', '国家/地区', 80], ['product', '产品', 160], ['contact', '联系方式', 200], ['owner', '负责人', 80]]) {
      if (typeof c[key] !== 'string' || !c[key].trim()) return `请填写${label}。`;
      if (c[key].length > max) return `${label}不能超过 ${max} 个字符。`;
    }
    if (!STAGES.includes(c.stage) || !SOURCES.includes(c.source)) return '请选择有效的销售阶段和来源。';
    if (!validDate(c.nextFollowUp)) return '请填写有效的下次跟进日期。';
    if (c.lastContact !== '' && !validDate(c.lastContact)) return '最近联系日期无效。';
    if (c.lastContact > today) return '最近联系日期不能晚于今天。';
    if (!['已成交', '已流失'].includes(c.stage) && c.lastContact && c.nextFollowUp < c.lastContact) return '下次跟进日期不能早于最近联系日期。';
    if (typeof c.notes !== 'string' || c.notes.length > 2000) return '备注不能超过 2000 个字符。';
    return '';
  }
  function status(c, today = localDate()) {
    if (['已成交', '已流失'].includes(c.stage)) return 'closed';
    if (!c.nextFollowUp) return 'normal';
    return c.nextFollowUp < today ? 'overdue' : c.nextFollowUp === today ? 'today' : 'normal';
  }
  function stats(customers, today = localDate()) {
    return { today: customers.filter(c => status(c, today) === 'today').length, overdue: customers.filter(c => status(c, today) === 'overdue').length,
      quoted: customers.filter(c => c.stage === '已报价').length, sampled: customers.filter(c => c.stage === '已寄样').length };
  }
  function filterCustomers(customers, filters, today = localDate()) {
    const q = normalize(filters.query), rank = { overdue: 0, today: 1, normal: 2, closed: 3 };
    return customers.filter(c => (!q || [c.name, c.product, c.country].some(v => normalize(v).includes(q)))
      && (!filters.stage || c.stage === filters.stage) && (!filters.owner || normalize(c.owner) === normalize(filters.owner))
      && (!filters.source || c.source === filters.source) && (!filters.country || normalize(c.country) === normalize(filters.country))
      && (!filters.task || filters.task === 'all' || status(c, today) === filters.task)).sort((a, b) => {
        if (filters.sort === 'name') return a.name.localeCompare(b.name);
        const priority = filters.sort === 'date' ? 0 : rank[status(a, today)] - rank[status(b, today)];
        return priority || a.nextFollowUp.localeCompare(b.nextFollowUp) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
      });
  }
  function distinct(customers, key) {
    const seen = new Map();
    for (const c of customers) if (!seen.has(normalize(c[key]))) seen.set(normalize(c[key]), c[key]);
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }
  function reconcileCountryFilter(customers, country) { return customers.find(c => normalize(c.country) === normalize(country))?.country || ''; }
  function ownValue(record, key) { return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined; }
  const api = { STAGES, SOURCES, FIELDS, normalize, localDate, validDate, clean, validate, status, stats, filterCustomers, distinct, countryOptions: c => distinct(c, 'country'), reconcileCountryFilter, ownValue,
    identity: c => JSON.stringify([normalize(c.name), normalize(c.country)]) };
  root.InquiryDomain = api;
})(globalThis);
