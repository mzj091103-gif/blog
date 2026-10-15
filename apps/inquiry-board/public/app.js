'use strict';
(() => {
  const D = window.InquiryDomain;
  const $ = selector => document.querySelector(selector);
  const icons = {
    dashboard: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M16 3v4M8 3v4M3 11h18m-13 5h3"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    document: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5"/>',
    package: '<path d="m12 3 9 5v10l-9 5-9-5V8zM3 8l9 5 9-5M12 13v10M7.5 5.5l9 5"/>',
    spark: '<path d="m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6z"/>',
    arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
    filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
    sort: '<path d="M8 4v16m-4-4 4 4 4-4m3-11h6m-6 5h4m-4 5h2"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>'
  };
  const svg = key => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[key] || icons.arrow}</svg>`;
  document.querySelectorAll('[data-icon]').forEach(el => el.innerHTML = svg(el.dataset.icon));
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const countries = { UAE: ['AE', '阿联酋'], 'Saudi Arabia': ['SA', '沙特阿拉伯'], Thailand: ['TH', '泰国'], Vietnam: ['VN', '越南'], Malaysia: ['MY', '马来西亚'], Indonesia: ['ID', '印度尼西亚'], Australia: ['AU', '澳大利亚'], Germany: ['DE', '德国'], Brazil: ['BR', '巴西'], Mexico: ['MX', '墨西哥'] };
  const stageClass = { '新询盘': 'new', '已联系': 'contacted', '已报价': 'quoted', '已寄样': 'sampled', '谈判中': 'negotiating', '已成交': 'won', '已流失': 'lost' };
  const sourceSymbol = { Alibaba: 'a', Google: 'G', Facebook: 'f', TikTok: '♪', Website: '◎' };

  let customers = [], today = D.localDate(), timezone = 'Asia/Shanghai', user = null;
  let loading = false, dataLoaded = false, saving = false, editingId = null, editingOriginal = null, requestId, initialForm = '', lastFocused, toastTimer;
  const state = { query: '', stage: '', owner: '', source: '', country: '', task: 'all', sort: 'priority', page: 1, pageSize: 8 };
  const form = () => $('#customer-form');
  const formValues = () => Object.fromEntries(new FormData(form()));
  const dirty = () => $('#customer-dialog').open && JSON.stringify(formValues()) !== initialForm;
  const ownerOptions = () => D.distinct([...customers, { owner: user?.email || '我' }], 'owner');
  function warning(text) { $('#storage-warning').textContent = text; $('#storage-warning').hidden = !text; }
  async function api(url, options = {}) {
    let response;
    try { response = await fetch(url, { credentials: 'same-origin', ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } }); }
    catch { throw new Error('网络连接中断，保存结果尚未确认。输入已保留，可重试；刷新列表可确认最新记录。'); }
    if (!response.headers.get('Content-Type')?.includes('application/json')) throw new Error('登录可能已过期。请先保留未保存的内容，再重新打开网站登录。');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '请求失败，请稍后重试。');
    return data;
  }
  async function load() {
    if (loading || saving || $('#customer-dialog').open) return;
    loading = true; $('#refresh-data').disabled = true; $('#save-state').textContent = '正在同步…';
    try {
      if (!user) {
        const session = await api('/api/session');
        user = session.user; timezone = session.timezone;
        $('#signed-in-user').textContent = user.email;
      }
      const data = await api('/api/customers');
      // An editor may have been opened while the network request was in flight.
      if (!$('#customer-dialog').open) { customers = data.customers; initFilters(); }
      today = data.today; timezone = data.timezone; dataLoaded = true;
      warning(''); $('#add-inquiry').disabled = false;
      $('#save-state').textContent = '已连接共享数据库'; render();
    } catch (e) { warning(e.message); $('#save-state').textContent = '连接失败 · 列表可能不是最新'; }
    finally { loading = false; $('#refresh-data').disabled = false; }
  }
  function options(values, placeholder, selected = '') {
    return (placeholder ? `<option value="">${escape(placeholder)}</option>` : '') + values.map(v => `<option value="${escape(v)}"${v === selected ? ' selected' : ''}>${escape(v)}</option>`).join('');
  }
  function initFilters() {
    state.owner = ownerOptions().find(owner => D.normalize(owner) === D.normalize(state.owner)) || '';
    $('#filter-stage').innerHTML = options(D.STAGES, '全部销售阶段', state.stage);
    $('#filter-owner').innerHTML = options(ownerOptions(), '全部负责人', state.owner);
    $('#filter-source').innerHTML = options(D.SOURCES, '全部来源渠道', state.source);
    state.country = D.reconcileCountryFilter(customers, state.country);
    $('#filter-country').innerHTML = options(D.countryOptions(customers), '全部国家 / 地区', state.country);
  }
  function initials(name) { return name.split(/\s+/).slice(0, 2).map(v => v[0] || '').join('').toUpperCase(); }
  function avatar(name, index = 0) { return `<span class="customer-avatar color-${index % 5}">${escape(initials(name))}</span>`; }
  function badge(stage) { return `<span class="stage-badge ${stageClass[stage]}"><span></span>${escape(stage)}</span>`; }
  function dateLabel(date) { return date ? date.replaceAll('-', '/') : '尚未联系'; }
  function row(c) {
    const follow = D.status(c, today), isClosed = follow === 'closed';
    const statusText = follow === 'today' ? '今日待跟进' : follow === 'overdue' ? '已逾期' : isClosed ? '已结束' : '按计划跟进';
    const country = D.ownValue(countries, c.country);
    const index = customers.findIndex(item => item.id === c.id);
    return `<tr class="row-${follow}" data-id="${escape(c.id)}"><td><div class="customer-cell">${avatar(c.name, index)}<div><button class="customer-name" data-open="${escape(c.id)}">${escape(c.name)}</button><div class="country-line"><span class="country-code">${escape(country ? country[0] : 'GL')}</span>${escape(c.country)}${country ? `<span class="country-cn"> · ${country[1]}</span>` : ''}</div></div></div></td><td><span class="source"><span class="source-logo source-${c.source.toLowerCase()}">${sourceSymbol[c.source]}</span>${escape(c.source)}</span></td><td class="product-cell">${escape(c.product)}</td><td>${badge(c.stage)}</td><td class="date-cell">${dateLabel(c.lastContact)}</td><td><div class="follow-date ${follow}">${dateLabel(c.nextFollowUp)}</div><span class="follow-label ${follow}">${follow === 'today' || follow === 'overdue' ? '<span class="mini-dot"></span>' : ''}${statusText}</span></td><td><span class="owner"><span class="owner-avatar color-${index % 5}">${escape(initials(c.owner))}</span>${escape(c.owner)}</span></td><td><button class="row-open icon-button" data-open="${escape(c.id)}" aria-label="查看 ${escape(c.name)} 详情">${svg('arrow')}</button></td></tr>`;
  }
  function render() {

    const counts = D.stats(customers, today);
    for (const key of Object.keys(counts)) $(`#stat-${key}`).textContent = counts[key];
    $('#today-label').textContent = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', timeZone: 'UTC' }).format(new Date(today + 'T12:00:00Z'));
    $('#today-label').dateTime = today;
    $('#focus-title').textContent = counts.overdue ? `有 ${counts.overdue} 位客户等待你的回复，优先跟进逾期询盘。` : `今天有 ${counts.today} 位客户待跟进，保持沟通节奏。`;
    for (const id of ['nav-count', 'total-count', 'tab-all']) $(`#${id}`).textContent = customers.length;
    $('#tab-today').textContent = counts.today; $('#tab-overdue').textContent = counts.overdue;
    const filtered = D.filterCustomers(customers, state, today), pages = Math.max(1, Math.ceil(filtered.length / state.pageSize));
    state.page = Math.min(state.page, pages);
    const start = (state.page - 1) * state.pageSize;
    $('#customer-rows').innerHTML = filtered.slice(start, start + state.pageSize).map(row).join('');
    $('#empty-state').hidden = !!filtered.length;
    $('#result-count').textContent = filtered.length ? `显示 ${start + 1}–${Math.min(start + state.pageSize, filtered.length)} 条，共 ${filtered.length} 位客户` : '共 0 位客户';
    $('#page-info').textContent = `${state.page} / ${pages}`;
    $('#prev-page').disabled = state.page <= 1; $('#next-page').disabled = state.page >= pages;
    $('#filter-summary').textContent = `匹配 ${filtered.length} / ${customers.length}`;
    const active = state.query || state.stage || state.owner || state.source || state.country || state.task !== 'all';
    $('#clear-filters').disabled = !active;
    document.querySelectorAll('[data-task]').forEach(el => { el.classList.toggle('active', el.dataset.task === state.task); el.setAttribute('aria-pressed', String(el.dataset.task === state.task)); });
    document.querySelectorAll('[data-stat]').forEach(el => {
      const selected = (el.dataset.stat === state.task && !state.stage) || (el.dataset.stat === 'quoted' && state.stage === '已报价') || (el.dataset.stat === 'sampled' && state.stage === '已寄样');
      el.classList.toggle('selected', selected); el.setAttribute('aria-pressed', String(selected));
    });
  }
  function clearFilters() {
    Object.assign(state, { query: '', stage: '', owner: '', source: '', country: '', task: 'all', page: 1 });
    $('#search').value = ''; initFilters(); render();
  }
  function pageRoute() {
    const isCustomers = location.hash === '#customers';
    $('#overview').hidden = isCustomers;
    $('#breadcrumb-title').textContent = isCustomers ? 'Customers' : 'Dashboard';
    $('#page-title').textContent = isCustomers ? '客户管理' : '客户询盘跟进看板';
    $('#page-description').textContent = isCustomers ? '集中维护客户信息，记录每一步销售进展。' : '把握每一次跟进，让每一条询盘都有进展。';
    document.querySelectorAll('[data-page]').forEach(el => { const selected = el.dataset.page === (isCustomers ? 'customers' : 'dashboard'); el.classList.toggle('active', selected); if (selected) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current'); });
  }
  function toast(message) {
    clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false;
    toastTimer = setTimeout(() => $('#toast').hidden = true, 3500);
  }

  function field(name, label, max, placeholder) {
    return '<label' + (['product','contact'].includes(name) ? ' class="full-width"' : '') + '>' + label + '<input name="' + name + '" required maxlength="' + max + '" placeholder="' + escape(placeholder) + '"></label>';
  }
  function openDrawer(id = null) {
    if (!dataLoaded) return;
    const c = id ? customers.find(item => item.id === id) : null;
    if (id && !c) { toast('记录已更新，请刷新列表。'); return; }
    editingId = c?.id || null; editingOriginal = c ? { ...c } : null;
    requestId = c?.id || crypto.randomUUID(); lastFocused = document.activeElement;
    form().reset(); $('#form-error').hidden = true;
    $('#drawer-title').textContent = c ? '客户详情' : '新增询盘';
    $('#drawer-eyebrow').textContent = c ? 'CUSTOMER DETAIL' : 'NEW INQUIRY';
    $('#save-customer').textContent = c ? '保存修改' : '创建询盘';
    $('#identity-fields').hidden = false; $('#last-contact-field').hidden = false;
    $('#customer-summary').hidden = !c;
    $('#identity-fields').innerHTML = field('name', '客户公司名称', 120, '客户公司名称') + field('country', '国家 / 地区', 80, '例如：UAE')
      + '<label>来源渠道<select name="source" required>' + options(D.SOURCES, '请选择来源', c?.source) + '</select></label>'
      + field('product', '感兴趣产品', 160, '例如：Silicone Sealant') + field('contact', '联系方式', 200, 'Email / WhatsApp');
    if (c) $('#customer-summary').innerHTML = '<p class="detail-meta">最近修改：' + escape(c.updatedBy) + ' · ' + escape(c.updatedAt) + '</p><details><summary>最近 50 次修改记录</summary><ol id="customer-history"><li>正在读取…</li></ol></details>';
    const control = name => form().elements.namedItem(name);
    for (const key of ['name','country','product','contact']) control(key).value = c?.[key] || '';
    control('stage').innerHTML = options(D.STAGES, '', c?.stage || '新询盘');
    $('#owner-options').innerHTML = options(ownerOptions(), '');
    control('owner').value = c?.owner || user.email;
    control('lastContact').value = c?.lastContact || '';
    control('nextFollowUp').value = c?.nextFollowUp || today;
    control('notes').value = c?.notes || '';
    initialForm = JSON.stringify(formValues());
    $('#customer-dialog').showModal(); control('name').focus();
    if (c) api('/api/customers/' + encodeURIComponent(c.id) + '/history').then(data => {
      if (editingId !== c.id || !$('#customer-dialog').open) return;
      $('#customer-history').innerHTML = data.history.map(h => '<li>' + escape(h.changed_at) + '<br>' + escape(h.actor) + ' · ' + (h.action === 'created' ? '新增' : '修改') + ' · 版本 ' + h.revision + '</li>').join('') || '<li>暂无记录</li>';
    }).catch(e => { if (editingId === c.id && $('#customer-history')) $('#customer-history').textContent = e.message; });
  }
  function closeDrawer(force = false) {
    if (saving) return;
    if (!force && dirty() && !window.confirm('有尚未保存的修改，确定放弃并关闭吗？')) return;
    $('#customer-dialog').close(); editingId = null; editingOriginal = null;
    (lastFocused?.isConnected ? lastFocused : $('#add-inquiry'))?.focus();
  }
  async function save(event) {
    event.preventDefault(); if (saving || !dataLoaded) return;
    let value;
    try { value = D.clean(formValues()); } catch (e) { $('#form-error').textContent = e.message; $('#form-error').hidden = false; return; }
    const error = D.validate(value, { today });
    if (error) { $('#form-error').textContent = error; $('#form-error').hidden = false; return; }
    const wasEdit = !!editingId, id = requestId;
    saving = true; $('#form-error').hidden = true;
    form().querySelectorAll('input,select,textarea,button').forEach(el => el.disabled = true);
    $('#save-customer').textContent = '正在保存…';
    try {
      const result = await api(wasEdit ? '/api/customers/' + encodeURIComponent(id) : '/api/customers', {
        method: wasEdit ? 'PUT' : 'POST', body: JSON.stringify(wasEdit ? { revision: editingOriginal.revision, customer: value } : { id, customer: value })
      });
      customers = wasEdit ? customers.map(c => c.id === id ? { ...c, ...result.customer } : c) : [result.customer, ...customers.filter(c => c.id !== id)];
      saving = false; initFilters(); if (wasEdit) render(); else clearFilters();
      closeDrawer(true); $('#save-state').textContent = '已保存到共享数据库'; toast(wasEdit ? '修改已保存' : '询盘已创建');
    } catch (e) { $('#form-error').textContent = e.message; $('#form-error').hidden = false; }
    finally {
      saving = false; form().querySelectorAll('input,select,textarea,button').forEach(el => el.disabled = false);
      $('#save-customer').textContent = wasEdit ? '保存修改' : '创建询盘';
    }
  }
  $('#search').addEventListener('input', e => { state.query = e.target.value; state.page = 1; render(); });
  for (const key of ['stage', 'owner', 'source', 'country']) $(`#filter-${key}`).addEventListener('change', e => { state[key] = e.target.value; state.page = 1; render(); });
  $('#sort').addEventListener('change', e => { state.sort = e.target.value; state.page = 1; render(); });
  $('#page-size').addEventListener('change', e => { state.pageSize = Number(e.target.value); state.page = 1; render(); });
  $('#prev-page').onclick = () => { state.page--; render(); };
  $('#next-page').onclick = () => { state.page++; render(); };
  document.querySelectorAll('[data-task]').forEach(el => el.onclick = () => { state.task = el.dataset.task; state.page = 1; render(); });
  document.querySelectorAll('[data-stat]').forEach(el => el.onclick = () => {
    clearFilters();
    if (['today', 'overdue'].includes(el.dataset.stat)) state.task = el.dataset.stat;
    else state.stage = el.dataset.stat === 'quoted' ? '已报价' : '已寄样';
    initFilters(); render(); $('.inquiries').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('#view-overdue').onclick = () => { clearFilters(); state.task = 'overdue'; render(); };
  $('#clear-filters').onclick = clearFilters; $('#empty-clear').onclick = clearFilters;
  $('#add-inquiry').onclick = () => openDrawer();
  $('#customer-rows').addEventListener('click', e => { const button = e.target.closest('[data-open]'), tr = e.target.closest('tr[data-id]'); if (button || tr) openDrawer(button?.dataset.open || tr.dataset.id); });
  $('#close-drawer').onclick = () => closeDrawer(); $('#cancel-drawer').onclick = () => closeDrawer();
  $('#customer-form').addEventListener('submit', save);
  $('#customer-dialog').addEventListener('cancel', event => { event.preventDefault(); closeDrawer(); });

  $('#refresh-data').onclick = load;
  $('#export-data').onclick = async () => {
    const button = $('#export-data'); button.disabled = true;
    try {
      const data = await api('/api/export');
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = 'tradeflow-' + data.exportedAt.slice(0, 10) + '.json';
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
      toast('备份已下载，请妥善保管客户资料');
    } catch (e) { warning(e.message); }
    finally { button.disabled = false; }
  };
  $('#logout').onclick = e => { if ((dirty() || saving) && !window.confirm('尚有修改未确认保存，确定退出登录吗？')) e.preventDefault(); };
  document.addEventListener('keydown', e => { if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) && !$('#customer-dialog').open) { e.preventDefault(); $('#search').focus(); } });
  window.addEventListener('beforeunload', e => { if (dirty() || saving) { e.preventDefault(); e.returnValue = ''; } });
  window.addEventListener('hashchange', () => { clearFilters(); pageRoute(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
  setInterval(async () => {
    if (document.hidden) return;
    if (!$('#customer-dialog').open) { load(); return; }
    try { const session = await api('/api/session'); if (today !== session.today) { today = session.today; render(); } } catch { /* Preserve the editor; save will report any connection error. */ }
  }, 60000);
  pageRoute(); initFilters(); render(); load();
})();
