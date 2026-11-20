'use strict';
const KEY = 'official-card-ledger-v1';
const INVOICES = ['未开票', '已开票', '发票异常', '无需发票', '未知'];
const STATUSES = ['未提交', '已提交', '审核中', '部分还款', '已还清', '不可报销'];
const $ = id => document.getElementById(id);
const clone = value => JSON.parse(JSON.stringify(value));
const uid = () => globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2);
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function cents(value) {
  const text = String(value).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw Error('金额须为非负数字，最多两位小数。');
  const [whole, fraction = ''] = text.split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2,'0'));
  if (!Number.isSafeInteger(result) || result > 1000000000000) throw Error('金额过大。');
  return result;
}
const decimal = value => `${Math.floor(value/100)}.${String(value%100).padStart(2,'0')}`;
const money = value => '¥' + decimal(value).replace(/\B(?=(\d{3})+\.)/g, ',');
const paid = record => record.payments.reduce((sum, p) => sum + p.amount, 0);
const balance = record => Math.max(0, record.amount - paid(record));
const activeSubmission = batch => !batch.cancelledAt;
function reimbursementState(record) {
  if (record.status === '不可报销') return 'ineligible';
  if (balance(record) === 0) return 'completed';
  if (record.submissions.some(activeSubmission) || ['已提交','审核中','已还清'].includes(record.status)) return 'processing';
  return 'pending';
}
const availableAmount = record => reimbursementState(record) === 'pending' ? balance(record) : 0;
function checkedBatchRecords(data, ids) {
  if (!ids.length || new Set(ids).size !== ids.length) throw Error('请选择支出，且每笔只能选择一次。');
  return ids.map(id => {
    const record = data.records.find(r => r.id === id);
    if (!record || availableAmount(record) <= 0) throw Error('所选项目已结清、不可报销或正在处理中，请重新选择。');
    return record;
  });
}
function submitRecords(data, ids, batch) {
  const records = checkedBatchRecords(data, ids);
  records.forEach(record => {
    record.submissions.push({...batch, amount:availableAmount(record)});
    record.status = '已提交';
  });
}
function cancelSubmission(data, id) {
  const records = data.records.filter(r => r.submissions.some(b => b.id === id && activeSubmission(b)));
  if (!records.length) throw Error('此批次已撤销或不存在。');
  records.forEach(record => {
    record.submissions.filter(b => b.id === id).forEach(b => { b.cancelledAt = today(); });
    if (!record.submissions.some(activeSubmission) && ['已提交','审核中'].includes(record.status)) {
      record.status = paid(record) > 0 ? '部分还款' : '未提交';
    }
  });
}
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01' || value > '9999-12-31') return false;
  const d = new Date(value + 'T00:00:00Z');
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === value;
}
function checkText(value, max, required = false) { return typeof value === 'string' && value.length <= max && (!required || value.trim().length > 0); }
function validate(data) {
  if (!data || data.version !== 1 || !Array.isArray(data.records) || data.records.length > 50000) throw Error('备份格式或版本无效。');
  const ids = new Set(), paymentIds = new Set(), batches = new Map();
  let total = 0;
  for (const r of data.records) {
    if (!r || !checkText(r.id,100,true) || ids.has(r.id)) throw Error('支出 ID 无效或重复。');
    ids.add(r.id);
    if (!validDate(r.date) || !['actual','source'].includes(r.dateKind) || !checkText(r.project,200,true) || !checkText(r.note,5000) || !INVOICES.includes(r.invoice) || !STATUSES.includes(r.status)) throw Error('支出日期、文本或状态无效。');
    if (!Number.isSafeInteger(r.amount) || r.amount <= 0 || r.amount > 1000000000000) throw Error('支出金额必须是有效的正整数分。');
    if (!Array.isArray(r.payments) || !Array.isArray(r.submissions)) throw Error('缺少还款或提交历史。');
    for (const p of r.payments) {
      if (!p || !checkText(p.id,100,true) || paymentIds.has(p.id) || !validDate(p.date) || !Number.isSafeInteger(p.amount) || p.amount <= 0 || p.amount > r.amount) throw Error('还款数据无效或还款 ID 重复。');
      paymentIds.add(p.id);
    }
    if (!Number.isSafeInteger(paid(r)) || paid(r) > r.amount) throw Error('累计还款超过垫付金额。');
    const ownBatches = new Set();
    for (const b of r.submissions) {
      if (!b || !checkText(b.id,100,true) || !checkText(b.name,200,true) || !validDate(b.date) || ownBatches.has(b.id)) throw Error('提交批次数据无效或重复。');
      ownBatches.add(b.id);
      if (b.cancelledAt !== undefined && !validDate(b.cancelledAt)) throw Error('批次撤销日期无效。');
      if (b.amount !== undefined && (!Number.isSafeInteger(b.amount) || b.amount <= 0 || b.amount > 1000000000000)) throw Error('批次申请金额无效。');
      const identity = JSON.stringify([b.name,b.date,b.cancelledAt]);
      if (batches.has(b.id) && batches.get(b.id) !== identity) throw Error('同一批次的信息不一致。');
      batches.set(b.id,identity);
    }
    total += r.amount;
    if (!Number.isSafeInteger(total)) throw Error('账本总金额过大。');
  }
  return data;
}
function seed() {
  return {version:1,records:[]};
}
let state = {version:1,records:[]}, storedRaw = null, storageBroken = false;
let selected = new Set(), payIds = [], batchIds = [], pending = null, fileMode = '';
let currentView = 'home';
let expenseCategory = 'all';
function choosingBatch() { return currentView === 'reimburse' && $('reimbursementMode').value !== 'manage'; }
function showView(view) {
  currentView = view;
  $('homeView').hidden = view !== 'home';
  $('ledgerView').hidden = !['expenses','reimburse'].includes(view);
  $('settingsView').hidden = view !== 'settings';
  $('batchbar').hidden = $('reimburseTools').hidden = view !== 'reimburse';
  $('ledgerTitle').textContent = view === 'reimburse' ? '报销与还款' : '支出明细';
  document.querySelectorAll('[data-view]').forEach(button => {
    if (button.dataset.view === view) button.setAttribute('aria-current','page');
    else button.removeAttribute('aria-current');
  });
  selected.clear();
  render();
}
function message(text, error = false) { $('message').className = 'feedback' + (error ? ' error' : ''); $('message').textContent = text; }
function commit(next, recovering = false) {
  validate(next);
  if (storageBroken && !recovering) throw Error('存储异常，请先通过 JSON 恢复有效账本。');
  if (localStorage.getItem(KEY) !== storedRaw) throw Error('其他页面已修改账本。请刷新后重试，当前操作尚未保存。');
  const raw = JSON.stringify(next);
  localStorage.setItem(KEY, raw);
  state = next; storedRaw = raw; storageBroken = false;
  selected = new Set([...selected].filter(id => state.records.some(r => r.id === id)));
  render();
}
function safely(action) { try { action(); } catch (e) { message(e.message, true); alert(e.message); } }
function filteredRecords() {
  const query = $('search').value.trim().toLowerCase(), month = $('month').value, batch = $('batchFilter').value;
  return state.records.filter(r => (!month || r.date.startsWith(month)) && (!query || `${r.id} ${r.project} ${r.note}`.toLowerCase().includes(query)) && (!batch || r.submissions.some(b => b.id === batch)));
}
function visibleRecords() {
  return filteredRecords().filter(r => {
    if (choosingBatch()) return availableAmount(r) > 0;
    if (currentView === 'expenses') return expenseCategory === 'all' || reimbursementState(r) === expenseCategory;
    return currentView !== 'reimburse' || !$('unpaidOnly').checked || balance(r) > 0;
  });
}
function renderCategories() {
  const records = filteredRecords();
  const categories = [['all','全部'],['pending','待报销'],['completed','已报销'],['ineligible','不可报销']];
  $('expenseCategories').hidden = currentView !== 'expenses';
  $('expenseCategories').innerHTML = categories.map(([key,label]) => {
    const count = records.filter(r => key === 'all' || reimbursementState(r) === key).length;
    return `<button type="button" data-category="${key}" aria-pressed="${expenseCategory === key}">${label} ${count}</button>`;
  }).join('');
  $('processingHint').hidden = currentView !== 'expenses';
  $('processingHint').textContent = `报销处理中 ${records.filter(r => reimbursementState(r) === 'processing').length} 笔，可在“全部”中查看。数量按当前月份、搜索和批次计算。`;
}
function tag(value) { const color = ['已开票','已还清','已报销'].includes(value) ? 'good' : ['发票异常','不可报销'].includes(value) ? 'bad' : ['未知','未开票','未提交','部分还款'].includes(value) ? 'warn' : ''; return `<span class="tag ${color}">${escapeHtml(value)}</span>`; }
function render() {
  const month = $('month').value;
  const records = state.records.filter(r => !month || r.date.startsWith(month));
  const sum = fn => records.reduce((s,r) => s + fn(r),0);
  $('homeMonth').value = month;
  const stats = [['累计垫付',sum(r=>r.amount)],['尚未收回',sum(balance)],['已收回',sum(paid)],['待提交报销',sum(r=>r.status==='未提交'?r.amount:0)],['发票异常',sum(r=>r.invoice==='发票异常'?r.amount:0)]];
  $('stats').innerHTML = stats.map(([label,value])=>`<div class="stat"><p>${label}</p><strong>${money(value)}</strong></div>`).join('');
  $('scope').textContent = month ? `${month} 支出 · 含跨月还款` : '全部月份';
  const previous = $('batchFilter').value, batches = new Map();
  state.records.forEach(r=>r.submissions.forEach(b=>batches.set(b.id,b)));
  $('batchFilter').innerHTML = '<option value="">全部批次</option>' + [...batches.values()].map(b=>`<option value="${escapeHtml(b.id)}">${escapeHtml(b.date+' '+b.name)}</option>`).join('');
  if (batches.has(previous)) $('batchFilter').value = previous;
  renderCategories();
  $('submitBatch').hidden = !choosingBatch();
  $('payBatch').hidden = choosingBatch();
  $('batchHistory').hidden = currentView !== 'reimburse' || choosingBatch();
  $('batchHistory').innerHTML = [...batches.values()].map(b => `<div class="history-row"><span>${escapeHtml(b.name)} · ${b.date} · ${activeSubmission(b) ? '有效' : '已撤销'}</span>${activeSubmission(b) ? `<button type="button" data-cancel-batch="${escapeHtml(b.id)}">撤销批次</button>` : ''}</div>`).join('');
  const visible = visibleRecords();
  selected = new Set([...selected].filter(id => visible.some(r => r.id === id)));
  $('count').textContent = `${visible.length} 笔`;
  $('records').innerHTML = visible.map(r=>`<article class="record"><div class="record-top"><input type="checkbox" data-select="${escapeHtml(r.id)}" aria-label="选择 ${escapeHtml(r.project)}" ${selected.has(r.id)?'checked':''}><div class="record-main"><h3>${escapeHtml(r.project)}</h3><div class="meta">${r.date}${r.dateKind==='source'?' · 来源日期，待核实':''} · ${escapeHtml(r.id)}</div><div class="tags">${tag(r.invoice)}${tag(({pending:'待报销',completed:'已报销',ineligible:'不可报销',processing:'报销处理中'})[reimbursementState(r)])}<span class="tag">登记状态 ${escapeHtml(r.status)}</span></div></div><div class="amount">${money(r.amount)}</div></div><div class="balance"><span>实际还款 ${money(paid(r))}</span><strong>未还款 ${money(balance(r))}</strong>${choosingBatch()?`<strong>当前可报销 ${money(availableAmount(r))}</strong>`:''}</div>${r.note?`<p class="note">${escapeHtml(r.note)}</p>`:''}<div class="record-actions"><button data-action="edit" data-id="${escapeHtml(r.id)}">编辑</button><button data-action="pay" data-id="${escapeHtml(r.id)}" ${balance(r)===0?'disabled':''}>登记还款</button><button data-action="delete" class="danger" data-id="${escapeHtml(r.id)}">删除</button></div>${r.payments.length||r.submissions.length?`<details><summary>还款与提交历史（${r.payments.length + r.submissions.length}）</summary>${r.payments.map(p=>`<div class="history-row"><span>${p.date} · 实际还款 ${money(p.amount)}</span><button class="danger" data-action="removePayment" data-id="${escapeHtml(r.id)}" data-payment="${escapeHtml(p.id)}">撤销此笔</button></div>`).join('')}${r.submissions.map(b=>`<div class="history-row"><span>${b.date} · 提交批次 ${escapeHtml(b.name)}${b.amount!==undefined?` · 申请 ${money(b.amount)}`:''}${b.cancelledAt?` · ${b.cancelledAt} 已撤销`:''}</span></div>`).join('')}</details>`:''}</article>`).join('') || '<div class="empty">暂无符合条件的支出</div>';
  const selectedAmount = visible.filter(r => selected.has(r.id)).reduce((sum,r) => sum + (choosingBatch() ? availableAmount(r) : balance(r)),0);
  $('selectedCount').textContent = `已选 ${selected.size} 笔 · ${money(selectedAmount)}`;
  $('submitBatch').disabled = $('payBatch').disabled = selected.size === 0;
  $('selectAll').checked = visible.length > 0 && visible.every(r=>selected.has(r.id));
  $('selectAll').indeterminate = visible.some(r=>selected.has(r.id)) && !$('selectAll').checked;
}
function openEditor(id) {
  const form = $('entryForm'); form.reset();
  const r = state.records.find(r=>r.id===id);
  const values = r ? {...r,amount:decimal(r.amount)} : {id:'',date:today(),dateKind:'actual',project:'',amount:'',invoice:'未开票',status:'未提交',note:''};
  Object.keys(values).forEach(k=>{ if(form.elements.namedItem(k)) form.elements.namedItem(k).value = values[k]; });
  $('editorTitle').textContent = r ? '编辑支出' : '新增支出'; $('editor').showModal();
}
function openPayments(ids) {
  payIds = ids.filter(id=>balance(state.records.find(r=>r.id===id))>0);
  if (!payIds.length) throw Error('所选支出均已全额还款。');
  $('payRows').innerHTML = payIds.map((id,i)=>{ const r=state.records.find(r=>r.id===id); return `<div class="pay-row"><strong>${escapeHtml(r.project)} · 未还款 ${money(balance(r))}</strong><p class="meta">${escapeHtml(r.id)}</p><div class="pay-inputs"><label>本次金额（元）<input name="amount${i}" inputmode="decimal" placeholder="留空跳过"></label><label>到账日期<input name="date${i}" type="date" value="${today()}" required></label></div></div>`; }).join('');
  $('repay').showModal();
}
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text],{type}));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.hidden = true;
  document.body.append(a);
  try { a.click(); }
  finally { setTimeout(() => { a.remove(); URL.revokeObjectURL(url); },120000); }
}
let backupUrl = null;
function backupMessage(text, error = false) {
  $('backupStatus').className = 'feedback' + (error ? ' error' : '');
  $('backupStatus').textContent = text;
}
function exportBackup(text, name) {
  const url = URL.createObjectURL(new Blob([text], {type:'application/json;charset=utf-8'}));
  if (backupUrl) URL.revokeObjectURL(backupUrl);
  backupUrl = url;
  const link = $('backupLink');
  link.href = url; link.download = name; link.hidden = false;
  link.textContent = '再次下载 ' + name;
  // Keep this real, visible link alive for Android's download manager and manual retry.
  link.click();
  backupMessage('备份生成成功，已请求下载。请在 Download / 下载目录确认文件；如未出现，请点击下方下载链接。');
}
function currentBackup() {
  const raw = localStorage.getItem(KEY);
  if (raw !== storedRaw) throw Error('其他页面已修改账本，请刷新后导出最新数据。');
  if (storageBroken) {
    if (raw === null) throw Error('当前存储无法读取，没有可导出的备份。');
    return raw;
  }
  return JSON.stringify(validate(state), null, 2);
}
function pickFile(mode) {
  try {
    pending = null;
    fileMode = mode;
    const input = $('file');
    input.value = '';
    input.accept = mode === 'json' ? 'application/json,.json' : 'text/csv,.csv';
    backupMessage('请选择 Download / 下载目录中的' + (mode === 'json' ? ' JSON 备份。' : ' CSV 文件。'));
    input.click(); // Synchronous call in the user's click handler preserves user activation.
  } catch (error) { backupMessage('无法打开文件选择器：' + error.message, true); }
}
function readTextFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(Error('读取文件失败：' + (reader.error?.message || '请确认文件已下载到本机并允许访问。')));
    reader.onabort = () => reject(Error('文件读取已取消。'));
    reader.readAsText(file, 'UTF-8');
  });
}
const HEADERS = ['ID','消费日期','日期性质','项目','金额（元）','备注','发票状态','报销状态','累计还款（元）','还款日期','分次还款JSON','提交批次JSON'];
// Prefix every text cell with an apostrophe. The importer removes exactly this prefix.
function csvCell(value) { return '"' + ("'" + String(value)).replace(/"/g,'""') + '"'; }
function toCSV(data) {
  const rows = data.records.map(r=>[r.id,r.date,r.dateKind,r.project,decimal(r.amount),r.note,r.invoice,r.status,decimal(paid(r)),r.payments.map(p=>p.date).join(';'),JSON.stringify(r.payments),JSON.stringify(r.submissions)]);
  return '\ufeff' + [HEADERS,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n');
}
function parseCSV(text) {
  text=text.replace(/^\ufeff/,'');
  const rows=[]; let row=[],cell='',quoted=false,closed=false;
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(quoted) { if(c==='"') { if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;} }else cell+=c; continue; }
    if(c==='"' && !cell && !closed){quoted=true;continue;}
    if(c===',' || c==='\n' || c==='\r') {
      row.push(cell);cell='';closed=false;
      if(c!==','){if(c==='\r' && text[i+1]==='\n')i++; if(row.some(v=>v!==''))rows.push(row);row=[];}
      continue;
    }
    if(closed || c==='"')throw Error('CSV 引号格式错误。');
    cell+=c;
  }
  if(quoted)throw Error('CSV 引号未闭合。');
  row.push(cell);if(row.some(v=>v!==''))rows.push(row);
  return rows.map(row=>row.map(v=>v.startsWith("'")?v.slice(1):v));
}
function fromCSV(text) {
  const rows=parseCSV(text), header=rows.shift();
  if(!header || JSON.stringify(header)!==JSON.stringify(HEADERS))throw Error('CSV 表头不匹配，请使用本应用导出的 CSV 模板。');
  const records=rows.map((row,i)=>{
    if(row.length!==HEADERS.length)throw Error(`CSV 第 ${i+2} 行列数不正确。`);
    const [id,date,dateKind,project,amount,note,invoice,status,total,dates,payments,submissions]=row;
    const r={id:id||uid(),date,dateKind,project,amount:cents(amount),note,invoice,status,payments:JSON.parse(payments||'[]'),submissions:JSON.parse(submissions||'[]')};
    validate({version:1,records:[r]});
    if(cents(total||'0')!==paid(r) || dates!==r.payments.map(p=>p.date).join(';'))throw Error(`CSV 第 ${i+2} 行的还款汇总与历史不一致。`);
    return r;
  });
  return validate({version:1,records});
}
function mergeCSV(incoming) {
  const next=clone(state); let added=0,skipped=0;
  for(const r of incoming.records) {
    const existing=next.records.find(e=>e.id===r.id);
    if(existing) {
      const fields=['id','date','dateKind','project','amount','note','invoice','status','payments','submissions'];
      if(fields.some(k=>JSON.stringify(existing[k])!==JSON.stringify(r[k])))throw Error(`ID ${r.id} 已存在且内容不同。请编辑原记录，或为新支出使用新 ID。`);
      skipped++;
    } else { next.records.push(r);added++; }
  }
  validate(next); return {next,added,skipped};
}
function init() {
  $('expenseCategories').onclick = event => {
    const button = event.target.closest('[data-category]');
    if (!button) return;
    expenseCategory = button.dataset.category; selected.clear(); render();
  };
  $('reimbursementMode').onchange = () => { selected.clear(); render(); };
  $('batchHistory').onclick = event => safely(() => {
    const button = event.target.closest('[data-cancel-batch]');
    if (!button || !confirm('撤销整个报销批次并解除所有关联支出的占用？已到账金额及历史会保留。')) return;
    const next = clone(state); cancelSubmission(next,button.dataset.cancelBatch); commit(next);
    message('批次已撤销，符合条件的剩余金额可重新提交。');
  });
  document.querySelectorAll('[data-view]').forEach(button => button.onclick = () => showView(button.dataset.view));
  $('goRepay').onclick = () => showView('reimburse');
  $('homeMonth').oninput = () => { $('month').value = $('homeMonth').value; selected.clear(); render(); };
  $('homeAllMonths').onclick = () => { $('month').value = ''; selected.clear(); render(); };
  $('unpaidOnly').onchange = () => { selected.clear(); render(); };
  $('entryForm').elements.invoice.innerHTML=INVOICES.map(v=>`<option>${v}</option>`).join('');
  $('entryForm').elements.status.innerHTML=STATUSES.map(v=>`<option>${v}</option>`).join('');
  try { storedRaw=localStorage.getItem(KEY); if(storedRaw===null)commit(seed()); else {state=validate(JSON.parse(storedRaw));render();} }
  catch(e){storageBroken=true;render();message('账本读取或保存失败。原存储未覆盖，请备份后恢复 JSON。'+e.message,true);}
  $('add').onclick=()=>openEditor();
  document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
  ['search','month','batchFilter'].forEach(id=>$(id).addEventListener('input',()=>{selected.clear();render();}));
  $('allMonths').onclick=()=>{$('month').value='';selected.clear();render();};
  $('selectAll').onchange=()=>{visibleRecords().forEach(r=>{if($('selectAll').checked)selected.add(r.id);else selected.delete(r.id);});render();};
  $('records').onchange=e=>{if(e.target.dataset.select){if(e.target.checked)selected.add(e.target.dataset.select);else selected.delete(e.target.dataset.select);render();}};
  $('records').onclick=e=>safely(()=>{
    const b=e.target.closest('button[data-action]'); if(!b)return;
    const id=b.dataset.id;
    if(b.dataset.action==='edit')return openEditor(id);
    if(b.dataset.action==='pay')return openPayments([id]);
    const next=clone(state), r=next.records.find(r=>r.id===id);
    if(b.dataset.action==='delete') {if(!confirm(`删除“${r.project}”及其全部还款与提交历史？此操作无法撤销。`))return;next.records=next.records.filter(r=>r.id!==id);}
    if(b.dataset.action==='removePayment'){if(!confirm('撤销这笔实际还款？余额将重新计算。'))return;r.payments=r.payments.filter(p=>p.id!==b.dataset.payment);}
    commit(next);message('已保存变更。');
  });
  $('entryForm').onsubmit=e=>{e.preventDefault();safely(()=>{
    const f=new FormData(e.target), next=clone(state), id=f.get('id');
    let r=next.records.find(r=>r.id===id);
    if(!r){r={id:uid(),payments:[],submissions:[]};next.records.push(r);}
    Object.assign(r,{date:f.get('date'),dateKind:f.get('dateKind'),project:f.get('project').trim(),amount:cents(f.get('amount')),note:f.get('note'),invoice:f.get('invoice'),status:f.get('status')});
    commit(next);$('editor').close();showView('expenses');message('支出已保存。');
  });};
  $('payBatch').onclick=()=>safely(()=>openPayments([...selected]));
  $('payForm').onsubmit=e=>{e.preventDefault();safely(()=>{
    const f=new FormData(e.target), next=clone(state);let count=0;
    payIds.forEach((id,i)=>{const amount=cents(f.get('amount'+i)||'0');if(!amount)return;const r=next.records.find(r=>r.id===id);r.payments.push({id:uid(),date:f.get('date'+i),amount});count++;});
    if(!count)throw Error('请至少填写一笔还款金额。');
    commit(next);$('repay').close();message(`已登记 ${count} 笔实际还款。`);
  });};
  $('submitBatch').onclick=()=>safely(()=>{
    batchIds=[...selected];
    const records = checkedBatchRecords(state,batchIds);
    $('batchForm').reset();$('batchForm').elements.date.value=today();
    $('batchSummary').textContent=`本次将提交 ${records.length} 笔，申请剩余金额 ${money(records.reduce((sum,r)=>sum+availableAmount(r),0))}。`;
    $('batch').showModal();
  });
  $('batchForm').onsubmit=e=>{e.preventDefault();safely(()=>{
    const f=new FormData(e.target),next=clone(state),batch={id:uid(),name:f.get('name').trim(),date:f.get('date')};
    submitRecords(next,batchIds,batch);commit(next);$('batch').close();message('提交批次已保存。');
  });};
  $('exportJson').onclick=()=>{
    try { exportBackup(currentBackup(), `gongwuka-backup-${today()}.json`); }
    catch (error) { backupMessage('导出失败：' + error.message, true); }
  };
  $('exportCsv').onclick=()=>safely(()=>download(`公务卡全部账目-${today()}.csv`,toCSV(state),'text/csv;charset=utf-8'));
  $('restoreJson').onclick=()=>pickFile('json');
  $('importCsv').onclick=()=>pickFile('csv');
  $('file').oncancel=()=>backupMessage('已取消选择文件，账本保持原样。');
  $('file').onchange=async e=>{
    const file=e.target.files[0], mode=fileMode;e.target.value='';pending=null;
    if(!file){backupMessage('已取消选择文件，账本保持原样。');return;}
    $('restoreJson').disabled = $('importCsv').disabled = true;
    const beforeRead = storedRaw;
    try {
      if(file.size>20000000)throw Error('文件超过 20MB，请拆分后再导入。');
      backupMessage('正在读取并验证文件…');
      const text=await readTextFile(file);
      if (storedRaw !== beforeRead || localStorage.getItem(KEY) !== beforeRead) throw Error('读取期间账本已变化，请重新选择文件。');
      const incoming=mode==='json'?validate(JSON.parse(text.replace(/^\ufeff/,''))):fromCSV(text);
      const merged=mode==='csv'?mergeCSV(incoming):null;
      pending={mode,next:merged?merged.next:incoming,raw:storedRaw};
      $('restoreTitle').textContent=mode==='json'?'确认恢复 JSON':'确认导入 CSV';
      $('restoreSummary').textContent=mode==='json'?`文件包含 ${incoming.records.length} 笔支出，合计 ${money(incoming.records.reduce((s,r)=>s+r.amount,0))}，将替换当前 ${state.records.length} 笔支出。`:`新增 ${merged.added} 笔，相同 ID 且内容一致的 ${merged.skipped} 笔将跳过。`;
      $('restoreHelp').textContent=mode==='json'?'确认后先下载当前账本的恢复前备份，并保留一份本地副本，然后替换。请保留下载文件。':'CSV 将合并到当前账本，包含分次还款与提交历史。任何验证错误都会取消整次导入。';
      $('restore').showModal();
      backupMessage('验证通过，请在弹窗中核对笔数、金额及覆盖提示。');
    }catch(error){pending=null;backupMessage('导入失败，账本未变更。'+error.message,true);}
    finally { $('restoreJson').disabled = $('importCsv').disabled = false; }
  };
  $('restore').addEventListener('close',()=>{pending=null;});
  $('confirmImport').onclick=()=>{
    try {
    if(!pending) return;
    if(storedRaw!==pending.raw || localStorage.getItem(KEY)!==pending.raw)throw Error('账本已变化，请关闭预览并重新导入。');
    if(pending.mode==='json' && storedRaw!==null){
      localStorage.setItem(KEY+'-before-restore',storedRaw);
      exportBackup(storedRaw,`gongwuka-before-restore-${today()}-${Date.now()}.json`);
    }
    commit(pending.next,pending.mode==='json');pending=null;selected.clear();
    $('month').value='';$('search').value='';$('batchFilter').value='';
    render();$('restore').close();backupMessage('恢复成功，统计和账目已更新。恢复前备份已保留在本机，请同时确认下载文件。');
    } catch(error) { $('restore').close();backupMessage('恢复失败，原账本已保留。'+error.message,true); }
  };
  window.addEventListener('storage',e=>{if(e.key===KEY || e.key===null)message('另一个页面更改了存储，请刷新后继续。当前页面的未保存操作不会覆盖新数据。',true);});
}
init();
let installPrompt = null;
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault(); installPrompt = event; $('installApp').hidden = false;
});
$('installApp').onclick = async () => {
  if (!installPrompt) return;
  try {
    await installPrompt.prompt();
    await installPrompt.userChoice;
  } catch (error) { message('请使用 Chrome 菜单中的安装入口。',true); }
  installPrompt = null; $('installApp').hidden = true;
};
window.addEventListener('appinstalled', () => {
  installPrompt = null; $('installApp').hidden = true;
  $('installHelp').textContent = '安装完成，可从手机桌面打开账本。';
});
if (location.protocol === 'https:' || location.protocol === 'http:') {
  $('offlineStatus').textContent = '正在准备离线缓存…';
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      $('refreshApp').hidden = false;
      $('offlineStatus').textContent = '新版缓存已就绪，保存编辑后点击“刷新应用”启用';
    });
    $('refreshApp').onclick = () => {
      if (document.querySelector('dialog[open]') && !confirm('刷新将关闭当前编辑窗口。确认已保存后继续？')) return;
      location.reload();
    };
    navigator.serviceWorker.register('./sw.js', {updateViaCache:'none'}).then(registration => {
      registration.update().catch(() => { /* Offline use continues with the installed cache. */ });
      return navigator.serviceWorker.ready;
    }).then(() => {
      $('offlineStatus').textContent = '离线缓存已就绪 · 可在此地址离线重开';
    }).catch(() => { $('offlineStatus').textContent = '离线缓存不可用，请使用 HTTPS 或 localhost'; });
  } else $('offlineStatus').textContent = '此环境不支持离线缓存，请使用 HTTPS 或 localhost';
}
