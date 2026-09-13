// Admin panel: authenticates with a GitHub Personal Access Token stored only
// in this browser's localStorage, reads orders.json via the GitHub Contents
// API, lets you edit status/payment fields, and commits changes back.
//
// IMPORTANT: change these two constants if you fork/rename the repo.
const REPO_OWNER = 'ineffabledesign';
const REPO_NAME = 'checkorder';
const FILE_PATH = 'data/orders.json'; // path to orders.json inside the repo
const BRANCH = 'main';

const API_BASE = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${FILE_PATH}`;

const STATE = {
  token: null,
  orders: [],
  sha: null,          // current file's git blob sha, required to commit an update
  dirty: new Set(),    // emailHashes with unsaved local edits
  selected: new Set(), // emailHashes checked for bulk action
  filter: 'all',
  query: '',
};

const els = {
  loginCard: document.getElementById('login-card'),
  loginForm: document.getElementById('login-form'),
  tokenInput: document.getElementById('token-input'),
  loginBtn: document.getElementById('login-btn'),
  loginError: document.getElementById('login-error'),
  toggleHelp: document.getElementById('toggle-help'),
  helpBox: document.getElementById('help-box'),

  dashboard: document.getElementById('dashboard'),
  btnLogout: document.getElementById('btn-logout'),
  searchInput: document.getElementById('search-input'),
  resultCount: document.getElementById('result-count'),
  filterRow: document.getElementById('filter-row'),
  selectAllCheckbox: document.getElementById('select-all-checkbox'),
  bulkBar: document.getElementById('bulk-bar'),
  bulkCount: document.getElementById('bulk-count'),
  bulkStatusSelect: document.getElementById('bulk-status-select'),
  btnApplyBulk: document.getElementById('btn-apply-bulk'),
  btnClearSelection: document.getElementById('btn-clear-selection'),
  orderList: document.getElementById('order-list'),
  saveBar: document.getElementById('save-bar'),
  saveStatus: document.getElementById('save-status'),
  btnSaveAll: document.getElementById('btn-save-all'),

  btnAddNew: document.getElementById('btn-add-new'),
  addModal: document.getElementById('add-modal'),
  btnCloseModal: document.getElementById('btn-close-modal'),
  btnCancelAdd: document.getElementById('btn-cancel-add'),
  addForm: document.getElementById('add-form'),
  newName: document.getElementById('new-name'),
  newEmail: document.getElementById('new-email'),
  newContact: document.getElementById('new-contact'),
  newItemsList: document.getElementById('new-items-list'),
  btnAddItemRow: document.getElementById('btn-add-item-row'),
  newTotal: document.getElementById('new-total'),
  newPaid: document.getElementById('new-paid'),
  newStatus: document.getElementById('new-status'),
  addError: document.getElementById('add-error'),
  btnSubmitAdd: document.getElementById('btn-submit-add'),
};

const STATUS_OPTIONS = [
  'Di Proses',
  'Sudah Dikonfirmasi',
  'Sedang Dikirim',
  'Selesai',
];

function styleForStatus(status) {
  if (/menunggu|pending|belum|diproses|di proses/i.test(status)) return 'status-pending';
  if (/konfirmasi|dikonfirmasi|confirmed|lunas|paid/i.test(status)) return 'status-confirmed';
  if (/kirim|dikirim|shipped|selesai/i.test(status)) return 'status-shipped';
  return 'status-default';
}

function formatRupiah(n) {
  return 'Rp' + Number(n || 0).toLocaleString('id-ID');
}

function maskContact(text) {
  // Mirrors mask_contact() in build_data.py — any run of 5+ digits (phone
  // numbers) gets masked down to the last 4 digits. Applied here too so a
  // number typed straight into the admin "add order" form doesn't end up
  // sitting in plaintext in orders.json, which is publicly downloadable.
  if (!text) return text;
  return text.replace(/\d{5,}/g, (digits) => '•'.repeat(digits.length - 4) + digits.slice(-4));
}

// ---------- auth / token handling ----------

function saveToken(token) {
  localStorage.setItem('admin_gh_token', token);
}
function loadToken() {
  return localStorage.getItem('admin_gh_token');
}
function clearToken() {
  localStorage.removeItem('admin_gh_token');
}

async function verifyToken(token) {
  const res = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Token tidak valid atau tidak punya akses ke repo ini.');
  return true;
}

// ---------- GitHub Contents API ----------

async function fetchOrdersFile(token) {
  const res = await fetch(`${API_BASE}?ref=${BRANCH}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Gagal mengambil orders.json dari repo.');
  const json = await res.json();
  const content = decodeURIComponent(escape(atob(json.content.replace(/\n/g, ''))));
  return { data: JSON.parse(content), sha: json.sha };
}

async function commitOrdersFile(token, orders, sha, message) {
  const content = JSON.stringify({ orders }, null, 2);
  const encoded = btoa(unescape(encodeURIComponent(content)));

  const res = await fetch(API_BASE, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: message || 'Update status pesanan lewat admin panel',
      content: encoded,
      sha,
      branch: BRANCH,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Gagal menyimpan perubahan ke GitHub.');
  }
  return res.json();
}

// ---------- login flow ----------

els.toggleHelp.addEventListener('click', () => {
  els.helpBox.hidden = !els.helpBox.hidden;
});

els.loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const token = els.tokenInput.value.trim();
  if (!token) return;

  els.loginError.hidden = true;
  els.loginBtn.disabled = true;
  els.loginBtn.classList.add('loading');

  try {
    await verifyToken(token);
    saveToken(token);
    STATE.token = token;
    await enterDashboard();
  } catch (err) {
    els.loginError.textContent = err.message;
    els.loginError.hidden = false;
  } finally {
    els.loginBtn.disabled = false;
    els.loginBtn.classList.remove('loading');
  }
});

els.btnLogout.addEventListener('click', () => {
  clearToken();
  STATE.token = null;
  STATE.orders = [];
  STATE.dirty.clear();
  els.dashboard.hidden = true;
  els.loginCard.hidden = false;
  els.tokenInput.value = '';
});

async function enterDashboard() {
  els.loginCard.hidden = true;
  els.dashboard.hidden = false;
  els.orderList.innerHTML = '<p class="empty-state">Memuat data pesanan...</p>';

  try {
    const { data, sha } = await fetchOrdersFile(STATE.token);
    STATE.orders = data.orders;
    STATE.sha = sha;
    renderList();
  } catch (err) {
    els.orderList.innerHTML = `<p class="empty-state">${err.message}</p>`;
  }
}

// ---------- list rendering ----------

function matchesFilter(order) {
  if (STATE.filter === 'pending') return styleForStatus(order.status) === 'status-pending';
  if (STATE.filter === 'confirmed') return styleForStatus(order.status) === 'status-confirmed';
  if (STATE.filter === 'shipped') return styleForStatus(order.status) === 'status-shipped';
  if (STATE.filter === 'unpaid') return Number(order.totalHarga || 0) > Number(order.sudahBayar || 0);
  return true;
}

function matchesQuery(order) {
  if (!STATE.query) return true;
  const q = STATE.query.toLowerCase();
  return order.name.toLowerCase().includes(q) || (order.contact || '').toLowerCase().includes(q);
}

function renderList() {
  const filtered = STATE.orders.filter(o => matchesFilter(o) && matchesQuery(o));
  els.resultCount.textContent = `${filtered.length} pesanan`;
  updateBulkBar(filtered);

  if (!filtered.length) {
    els.orderList.innerHTML = '<p class="empty-state">Gak ada pesanan yang cocok.</p>';
    return;
  }

  els.orderList.innerHTML = '';
  filtered.forEach(order => els.orderList.appendChild(buildOrderCard(order)));
}

function buildOrderCard(order) {
  const card = document.createElement('div');
  card.className = 'order-card';
  if (STATE.dirty.has(order.emailHash)) card.classList.add('is-dirty');
  if (STATE.selected.has(order.emailHash)) card.classList.add('is-selected');

  const itemsSummary = (order.items || []).map(i => i.label).join(', ') || 'Tidak ada item';
  const badgeClass = styleForStatus(order.status);

  card.innerHTML = `
    <div class="order-card-top">
      <input type="checkbox" class="order-checkbox" ${STATE.selected.has(order.emailHash) ? 'checked' : ''} aria-label="Pilih pesanan ini">
      <div class="order-card-main">
        <div class="order-card-name">${escapeHtml(order.name)}</div>
        <div class="order-card-email">${escapeHtml(order.contact || '')}</div>
        <div class="order-card-items">${escapeHtml(itemsSummary)}</div>
      </div>
      <span class="order-card-badge status-pill ${badgeClass}">${escapeHtml(order.status)}</span>
    </div>
    <div class="order-card-body">
      <div class="field">
        <label>Status</label>
        <select class="f-status">
          ${STATUS_OPTIONS.map(s => `<option value="${escapeHtml(s)}" ${s === order.status ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}
        </select>
      </div>
      <div class="field-row">
        <div class="field">
          <label>Total Harga (Rp)</label>
          <input type="number" class="f-total" value="${order.totalHarga || 0}" min="0" step="1000">
        </div>
        <div class="field">
          <label>Sudah Dibayar (Rp)</label>
          <input type="number" class="f-paid" value="${order.sudahBayar || 0}" min="0" step="1000">
        </div>
      </div>
      <div class="remaining-preview">
        Sisa pelunasan: <strong class="f-remaining-text"></strong>
      </div>
    </div>
  `;

  const top = card.querySelector('.order-card-top');
  const checkbox = card.querySelector('.order-checkbox');
  const statusSelect = card.querySelector('.f-status');
  const totalInput = card.querySelector('.f-total');
  const paidInput = card.querySelector('.f-paid');
  const remainingText = card.querySelector('.f-remaining-text');
  const remainingPreview = card.querySelector('.remaining-preview');
  const badge = card.querySelector('.order-card-badge');

  function updateRemainingPreview() {
    const total = Number(totalInput.value || 0);
    const paid = Number(paidInput.value || 0);
    const remaining = Math.max(total - paid, 0);
    remainingText.textContent = formatRupiah(remaining);
    remainingPreview.classList.toggle('is-settled', remaining === 0 && total > 0);
  }
  updateRemainingPreview();

  // clicking the row (name/status area) expands the card; clicking the
  // checkbox itself should only toggle selection, not expand/collapse
  top.addEventListener('click', (e) => {
    if (e.target === checkbox) return;
    card.classList.toggle('is-open');
  });

  checkbox.addEventListener('click', (e) => e.stopPropagation());
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) {
      STATE.selected.add(order.emailHash);
    } else {
      STATE.selected.delete(order.emailHash);
    }
    card.classList.toggle('is-selected', checkbox.checked);
    updateBulkBar(STATE.orders.filter(o => matchesFilter(o) && matchesQuery(o)));
  });

  function markDirty() {
    order.status = statusSelect.value;
    order.totalHarga = Number(totalInput.value || 0);
    order.sudahBayar = Number(paidInput.value || 0);
    STATE.dirty.add(order.emailHash);
    card.classList.add('is-dirty');
    badge.textContent = order.status;
    badge.className = `order-card-badge status-pill ${styleForStatus(order.status)}`;
    updateRemainingPreview();
    updateSaveBar();
  }

  statusSelect.addEventListener('change', markDirty);
  totalInput.addEventListener('input', markDirty);
  paidInput.addEventListener('input', markDirty);

  return card;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

async function sha256(text) {
  const normalized = text.trim().toLowerCase();
  const enc = new TextEncoder().encode(normalized);
  const hashBuffer = await crypto.subtle.digest('SHA-256', enc);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ---------- add new order modal ----------

function addItemRow(name = '', detail = '') {
  const row = document.createElement('div');
  row.className = 'item-row';
  row.innerHTML = `
    <input type="text" class="item-name-input" placeholder="Nama item (misal: Totebag)" value="${escapeHtml(name)}">
    <input type="text" class="item-detail-input" placeholder="Detail (misal: Bubble Gum (1))" value="${escapeHtml(detail)}">
    <button type="button" class="btn-remove-item" aria-label="Hapus item">✕</button>
  `;
  row.querySelector('.btn-remove-item').addEventListener('click', () => row.remove());
  els.newItemsList.appendChild(row);
}

function resetAddForm() {
  els.addForm.reset();
  els.newItemsList.innerHTML = '';
  addItemRow();
  els.newStatus.innerHTML = STATUS_OPTIONS.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
  els.addError.hidden = true;
}

function openAddModal() {
  resetAddForm();
  els.addModal.hidden = false;
  els.newName.focus();
}

function closeAddModal() {
  els.addModal.hidden = true;
}

els.btnAddNew.addEventListener('click', openAddModal);
els.btnCloseModal.addEventListener('click', closeAddModal);
els.btnCancelAdd.addEventListener('click', closeAddModal);
els.addModal.addEventListener('click', (e) => {
  if (e.target === els.addModal) closeAddModal();
});

els.btnAddItemRow.addEventListener('click', () => addItemRow());

els.addForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  els.addError.hidden = true;

  const name = els.newName.value.trim();
  const email = els.newEmail.value.trim();
  const contact = maskContact(els.newContact.value.trim());

  if (!name || !email) {
    els.addError.textContent = 'Nama dan email wajib diisi.';
    els.addError.hidden = false;
    return;
  }

  const emailHash = await sha256(email);

  // guard against accidentally creating a duplicate order for an email
  // that's already in the list — surface it instead of silently shadowing it
  if (STATE.orders.some(o => o.emailHash === emailHash)) {
    els.addError.textContent = 'Email ini sudah ada di daftar pesanan. Cari namanya di list buat edit, bukan tambah baru.';
    els.addError.hidden = false;
    return;
  }

  const items = [];
  els.newItemsList.querySelectorAll('.item-row').forEach(row => {
    const label = row.querySelector('.item-name-input').value.trim();
    const detail = row.querySelector('.item-detail-input').value.trim();
    if (label || detail) items.push({ label: label || 'Item', detail: detail || '-' });
  });

  const newOrder = {
    emailHash,
    name,
    contact,
    items,
    paymentMethod: null,
    status: els.newStatus.value,
    totalHarga: Number(els.newTotal.value || 0),
    sudahBayar: Number(els.newPaid.value || 0),
  };

  els.btnSubmitAdd.disabled = true;
  els.btnSubmitAdd.textContent = 'Menyimpan...';

  try {
    // Same lost-update guard as the bulk save: fetch the latest orders.json
    // right before writing, so adding one order doesn't overwrite edits
    // made from another tab/device in the meantime.
    const latest = await fetchOrdersFile(STATE.token);
    if (latest.data.orders.some(o => o.emailHash === emailHash)) {
      els.addError.textContent = 'Email ini sudah ada di daftar pesanan (baru ditambahkan dari tempat lain). Coba refresh dan cek lagi.';
      els.addError.hidden = false;
      return;
    }

    const mergedOrders = [...latest.data.orders, newOrder];
    const result = await commitOrdersFile(
      STATE.token,
      mergedOrders,
      latest.sha,
      `Tambah pesanan baru: ${name}`
    );
    STATE.orders = mergedOrders;
    STATE.sha = result.content.sha;
    closeAddModal();
    renderList();
  } catch (err) {
    els.addError.textContent = err.message;
    els.addError.hidden = false;
  } finally {
    els.btnSubmitAdd.disabled = false;
    els.btnSubmitAdd.textContent = 'Simpan Pesanan';
  }
});

// ---------- filters / search ----------

els.filterRow.addEventListener('click', (e) => {
  const btn = e.target.closest('.chip');
  if (!btn) return;
  els.filterRow.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  STATE.filter = btn.dataset.filter;
  renderList();
});

els.searchInput.addEventListener('input', () => {
  STATE.query = els.searchInput.value;
  renderList();
});

// ---------- bulk actions ----------

function updateBulkBar(filteredOrders) {
  const filteredHashes = new Set(filteredOrders.map(o => o.emailHash));
  // keep selection only for orders currently visible under the active filter/search,
  // so a stale selection from a previous filter doesn't silently apply to the wrong set
  const visibleSelectedCount = [...STATE.selected].filter(h => filteredHashes.has(h)).length;

  els.bulkBar.hidden = visibleSelectedCount === 0;
  els.bulkCount.textContent = visibleSelectedCount === 1
    ? '1 pesanan dipilih'
    : `${visibleSelectedCount} pesanan dipilih`;

  if (!els.bulkStatusSelect.dataset.populated) {
    els.bulkStatusSelect.innerHTML = STATUS_OPTIONS.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
    els.bulkStatusSelect.dataset.populated = 'true';
  }

  const allChecked = filteredOrders.length > 0 && filteredOrders.every(o => STATE.selected.has(o.emailHash));
  els.selectAllCheckbox.checked = allChecked;
  els.selectAllCheckbox.indeterminate = !allChecked && visibleSelectedCount > 0;
}

els.selectAllCheckbox.addEventListener('change', () => {
  const filtered = STATE.orders.filter(o => matchesFilter(o) && matchesQuery(o));
  if (els.selectAllCheckbox.checked) {
    filtered.forEach(o => STATE.selected.add(o.emailHash));
  } else {
    filtered.forEach(o => STATE.selected.delete(o.emailHash));
  }
  renderList();
});

els.btnApplyBulk.addEventListener('click', () => {
  const newStatus = els.bulkStatusSelect.value;
  const filtered = STATE.orders.filter(o => matchesFilter(o) && matchesQuery(o));
  const targets = filtered.filter(o => STATE.selected.has(o.emailHash));

  targets.forEach(order => {
    order.status = newStatus;
    STATE.dirty.add(order.emailHash);
  });

  updateSaveBar();
  renderList();
});

els.btnClearSelection.addEventListener('click', () => {
  STATE.selected.clear();
  renderList();
});

// ---------- save bar ----------

function updateSaveBar() {
  const count = STATE.dirty.size;
  els.saveBar.hidden = count === 0;
  els.saveStatus.textContent = count === 1
    ? '1 pesanan belum disimpan'
    : `${count} pesanan belum disimpan`;
}

els.btnSaveAll.addEventListener('click', async () => {
  els.btnSaveAll.disabled = true;
  els.btnSaveAll.textContent = 'Menyimpan...';

  try {
    // Guard against a lost-update: if another tab (or another device) saved
    // changes after this tab loaded its copy, blindly pushing STATE.orders
    // would silently wipe those changes out. So we re-fetch the latest data
    // right before saving, apply only the fields this tab actually edited
    // (STATE.dirty) on top of that latest copy, and commit the merged result.
    const latest = await fetchOrdersFile(STATE.token);
    const latestByHash = new Map(latest.data.orders.map(o => [o.emailHash, o]));

    STATE.orders.forEach(localOrder => {
      if (!STATE.dirty.has(localOrder.emailHash)) return;
      latestByHash.set(localOrder.emailHash, {
        ...(latestByHash.get(localOrder.emailHash) || {}),
        status: localOrder.status,
        totalHarga: localOrder.totalHarga,
        sudahBayar: localOrder.sudahBayar,
      });
    });

    const mergedOrders = [...latestByHash.values()];

    const result = await commitOrdersFile(
      STATE.token,
      mergedOrders,
      latest.sha,
      `Update ${STATE.dirty.size} pesanan lewat admin panel`
    );
    STATE.orders = mergedOrders;
    STATE.sha = result.content.sha;
    STATE.dirty.clear();
    STATE.selected.clear();
    updateSaveBar();
    renderList();
  } catch (err) {
    alert(err.message);
  } finally {
    els.btnSaveAll.disabled = false;
    els.btnSaveAll.textContent = 'Simpan Semua Perubahan';
  }
});

// ---------- boot ----------

(async function init() {
  const saved = loadToken();
  if (saved) {
    STATE.token = saved;
    try {
      await verifyToken(saved);
      await enterDashboard();
    } catch {
      clearToken();
    }
  }
})();
