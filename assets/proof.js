// QRIS + upload bukti TF di halaman customer.
// Berdiri sendiri: tidak mengubah app.js. Ia menghitung hash email yang sama
// seperti build_data.py (trim + lowercase + SHA-256), lalu muncul di bawah
// rincian pembayaran kalau masih ada sisa pelunasan.
(function () {
  const API = window.PROOF_API;
  if (!API || API.includes('PASTE')) return;

  const form = document.getElementById('search-form');
  const input = document.getElementById('email-input');
  const result = document.getElementById('state-result');
  const payBlock = document.getElementById('payment-block');
  if (!form || !input || !result || !payBlock) return;

  let hashPromise = null;

  async function sha256(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text.trim().toLowerCase()));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function call(body) {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
    });
    return res.json();
  }

  // Kecilkan screenshot jadi maks 1400px (~200-300 KB) supaya Drive tidak cepat penuh.
  async function shrink(file) {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1400 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.8).split(',')[1];
  }

  function mount(hash) {
    const old = document.getElementById('proof-box');
    if (old) old.remove();

    const remaining = parseInt((document.getElementById('payment-remaining').textContent || '').replace(/\D/g, ''), 10) || 0;
    if (payBlock.hidden || remaining <= 0) return; // belum ada tagihan, atau sudah lunas

    const box = document.createElement('div');
    box.id = 'proof-box';
    box.className = 'proof-box';
    box.innerHTML = `
      <p class="items-label">Cara bayar</p>
      <img class="proof-qris" src="assets/qris.jpeg" alt="QRIS Ineffable Design">
      <p class="proof-note">Scan QRIS di atas, ketik nominal <strong>Rp${remaining.toLocaleString('id-ID')}</strong>, lalu upload bukti transfernya di sini.</p>
      <label class="proof-pick">
        <input type="file" accept="image/*" hidden>
        <span class="proof-pick-text">Pilih screenshot bukti TF</span>
      </label>
      <button type="button" class="proof-send" disabled>Kirim bukti</button>
      <p class="proof-msg" role="status"></p>`;
    payBlock.after(box);

    const file = box.querySelector('input');
    const pickText = box.querySelector('.proof-pick-text');
    const send = box.querySelector('.proof-send');
    const msg = box.querySelector('.proof-msg');

    file.addEventListener('change', () => {
      pickText.textContent = file.files[0] ? file.files[0].name : 'Pilih screenshot bukti TF';
      send.disabled = !file.files[0];
    });

    send.addEventListener('click', async () => {
      if (!file.files[0]) return;
      send.disabled = true;
      msg.className = 'proof-msg';
      msg.textContent = 'Mengirim...';
      try {
        const data = await shrink(file.files[0]);
        const r = await call({ action: 'upload', hash, mime: 'image/jpeg', data });
        if (!r.ok) throw new Error(r.error || 'Gagal mengirim.');
        msg.className = 'proof-msg is-ok';
        msg.textContent = `Bukti terkirim (${r.at}). Kami cek dulu ya, statusnya akan diperbarui setelah dikonfirmasi.`;
        pickText.textContent = 'Kirim ulang kalau salah upload';
        file.value = '';
      } catch (err) {
        msg.className = 'proof-msg is-err';
        msg.textContent = (err.message || 'Gagal mengirim') + ' — coba lagi, atau kirim lewat Instagram kami.';
        send.disabled = false;
      }
    });

    // kalau sebelumnya sudah pernah kirim, kasih tahu
    call({ action: 'status', hash }).then(r => {
      if (r.uploaded && !msg.textContent) {
        msg.className = 'proof-msg is-ok';
        msg.textContent = `Bukti kamu sudah kami terima (${r.at}), menunggu dicek. Salah kirim? Upload ulang saja.`;
      }
    }).catch(() => {});
  }

  form.addEventListener('submit', () => { hashPromise = sha256(input.value); });

  new MutationObserver(() => {
    if (result.hidden || !hashPromise) return;
    setTimeout(async () => mount(await hashPromise), 60); // tunggu app.js selesai mengisi angka
  }).observe(result, { attributes: true, attributeFilter: ['hidden'] });
})();
