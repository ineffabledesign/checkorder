// Preorder status lookup.
// Emails in data/orders.json are stored as SHA-256 hashes, never plaintext.
// We hash the typed email client-side (Web Crypto API) and compare hashes —
// the raw email never leaves the browser.

const STATE = {
  orders: null,
};

const els = {
  form: document.getElementById('search-form'),
  input: document.getElementById('email-input'),
  submitBtn: document.getElementById('submit-btn'),
  stateSearch: document.getElementById('state-search'),
  stateNotFound: document.getElementById('state-notfound'),
  stateResult: document.getElementById('state-result'),
  resultName: document.getElementById('result-name'),
  statusPill: document.getElementById('status-pill'),
  statusText: document.getElementById('status-text'),
  itemsList: document.getElementById('items-list'),
  paymentBlock: document.getElementById('payment-block'),
  paymentTotal: document.getElementById('payment-total'),
  paymentPaid: document.getElementById('payment-paid'),
  paymentRemaining: document.getElementById('payment-remaining'),
  paymentRemainingRow: document.getElementById('payment-remaining-row'),
  btnBack: document.getElementById('btn-back'),
  btnRetryNotFound: document.getElementById('btn-retry-notfound'),
};

// Map raw status strings (as typed in orders.json) to a display style.
// Add more entries here as you invent new status labels — anything not
// matched below just falls back to a neutral grey pill with the text as-is.
const STATUS_STYLES = [
  { match: /menunggu|pending|belum|diproses|di proses/i, className: 'status-pending' },
  { match: /konfirmasi|dikonfirmasi|confirmed|lunas|paid/i, className: 'status-confirmed' },
  { match: /kirim|dikirim|shipped|selesai/i, className: 'status-shipped' },
];

function styleForStatus(status) {
  const found = STATUS_STYLES.find(s => s.match.test(status));
  return found ? found.className : 'status-default';
}

async function sha256(text) {
  const normalized = text.trim().toLowerCase();
  const enc = new TextEncoder().encode(normalized);
  const hashBuffer = await crypto.subtle.digest('SHA-256', enc);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function loadOrders() {
  if (STATE.orders) return STATE.orders;
  const res = await fetch('data/orders.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('Gagal memuat data pesanan');
  const json = await res.json();
  STATE.orders = json.orders;
  return STATE.orders;
}

function showState(name) {
  els.stateSearch.hidden = name !== 'search';
  els.stateNotFound.hidden = name !== 'notfound';
  els.stateResult.hidden = name !== 'result';
}

function renderResult(order) {
  els.resultName.textContent = order.name;

  const styleClass = styleForStatus(order.status);
  els.statusPill.className = `status-pill ${styleClass}`;
  els.statusText.textContent = order.status;

  renderPayment(order);

  els.itemsList.innerHTML = '';
  if (order.items && order.items.length) {
    order.items.forEach(item => {
      const li = document.createElement('li');
      const nameSpan = document.createElement('span');
      nameSpan.className = 'item-name';
      nameSpan.textContent = item.label;
      const detailSpan = document.createElement('span');
      detailSpan.className = 'item-detail';
      detailSpan.textContent = item.detail;
      li.appendChild(nameSpan);
      li.appendChild(detailSpan);
      els.itemsList.appendChild(li);
    });
  } else {
    const li = document.createElement('li');
    li.textContent = 'Belum ada rincian item.';
    els.itemsList.appendChild(li);
  }

  showState('result');
}

function formatRupiah(n) {
  return 'Rp' + Number(n || 0).toLocaleString('id-ID');
}

function renderPayment(order) {
  const total = Number(order.totalHarga || 0);
  const paid = Number(order.sudahBayar || 0);
  const remaining = Math.max(total - paid, 0);

  // If total hasn't been filled in yet, don't show a misleading Rp0 breakdown
  if (!total) {
    els.paymentBlock.hidden = true;
    return;
  }

  els.paymentBlock.hidden = false;
  els.paymentTotal.textContent = formatRupiah(total);
  els.paymentPaid.textContent = formatRupiah(paid);
  els.paymentRemaining.textContent = formatRupiah(remaining);

  els.paymentRemainingRow.classList.toggle('is-settled', remaining === 0);
}

function setLoading(isLoading) {
  els.submitBtn.disabled = isLoading;
  els.submitBtn.classList.toggle('loading', isLoading);
}

async function handleSubmit(e) {
  e.preventDefault();
  const email = els.input.value;
  if (!email) return;

  els.input.classList.remove('input-error');
  setLoading(true);

  try {
    const [orders, hash] = await Promise.all([loadOrders(), sha256(email)]);
    const match = orders.find(o => o.emailHash === hash);

    // small deliberate delay so the loading state doesn't just flash
    await new Promise(r => setTimeout(r, 350));

    if (match) {
      renderResult(match);
    } else {
      showState('notfound');
    }
  } catch (err) {
    console.error(err);
    els.input.classList.add('input-error');
  } finally {
    setLoading(false);
  }
}

els.form.addEventListener('submit', handleSubmit);

els.btnBack.addEventListener('click', () => {
  showState('search');
  els.input.value = '';
  els.input.focus();
});

els.btnRetryNotFound.addEventListener('click', () => {
  showState('search');
  els.input.value = '';
  els.input.focus();
});

// preload orders.json in the background so the first search feels instant
loadOrders().catch(() => {});
