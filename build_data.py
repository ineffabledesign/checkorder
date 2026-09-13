"""
Convert Rekap_AUGUST_PREORDER__Responses_.xlsx into data/orders.json
for the preorder status-check website.

Re-run this any time you get a new batch of orders — it will regenerate
orders.json from scratch. If you've already been hand-editing "status"
values in orders.json, this script will preserve them by matching on
email (see MERGE step below).
"""

import pandas as pd
import json
import hashlib
import os

SRC_XLSX = "Rekap_AUGUST_PREORDER__Responses_.xlsx"
OUT_JSON = "data/orders.json"

ITEM_COLUMNS = [
    "PHONECASE (Code/Phonetype)",
    "Rekap Totebag",
    "Rekap Emotional Pouch",
    "Rekap Cord Holder",
    "Rekap Pin Button Set",
    "Rekap Glossy Square Pin",
    "Rekap Emoney Stickers",
    "Rekap Glitter Die Cut Stickers",
    "Rekap Hand Sanitizer",
    "Rekap Holo Keychain",
]

# Nicer display labels for each column
LABELS = {
    "PHONECASE (Code/Phonetype)": "Phonecase",
    "Rekap Totebag": "Totebag",
    "Rekap Emotional Pouch": "Emotional Pouch",
    "Rekap Cord Holder": "Cord Holder",
    "Rekap Pin Button Set": "Pin Button Set",
    "Rekap Glossy Square Pin": "Glossy Square Pin",
    "Rekap Emoney Stickers": "Emoney Stickers",
    "Rekap Glitter Die Cut Stickers": "Glitter Die Cut Stickers",
    "Rekap Hand Sanitizer": "Hand Sanitizer",
    "Rekap Holo Keychain": "Holo Keychain",
}


def email_hash(email: str) -> str:
    """One-way hash so raw emails aren't sitting in plaintext in the repo."""
    normalized = email.strip().lower()
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def build():
    df = pd.read_excel(SRC_XLSX)

    # try to preserve any statuses/payment amounts already set by hand in an existing orders.json
    existing_status = {}
    existing_payment = {}
    if os.path.exists(OUT_JSON):
        with open(OUT_JSON, "r", encoding="utf-8") as f:
            old = json.load(f)
            for rec in old.get("orders", []):
                existing_status[rec["emailHash"]] = rec.get("status", "Di Proses")
                existing_payment[rec["emailHash"]] = {
                    "totalHarga": rec.get("totalHarga", 0),
                    "sudahBayar": rec.get("sudahBayar", 0),
                }

    orders = []
    for _, row in df.iterrows():
        email = str(row["Email aktif"]).strip()
        if not email or email.lower() == "nan":
            continue

        items = []
        for col in ITEM_COLUMNS:
            val = row.get(col)
            if pd.notna(val) and str(val).strip():
                items.append({"label": LABELS[col], "detail": str(val).strip()})

        # These source columns are messy free-text notes (amounts, names, requests
        # scribbled in by whoever filled the form) — show verbatim, don't try to
        # reformat/parse them since that risks misrepresenting what was written.
        transfer_val = row.get("Transfer")
        qris_val = row.get("QRIS PAYMENT")
        if pd.notna(transfer_val) and str(transfer_val).strip().upper() == "QRIS":
            payment_method = "QRIS" if pd.isna(qris_val) else f"QRIS — {qris_val}"
        elif pd.notna(qris_val):
            payment_method = f"QRIS — {qris_val}"
        elif pd.notna(transfer_val):
            payment_method = f"Transfer — {transfer_val}"
        else:
            payment_method = None

        h = email_hash(email)
        prev_payment = existing_payment.get(h, {"totalHarga": 0, "sudahBayar": 0})
        record = {
            "emailHash": h,
            "name": str(row["Nama Pemesan"]).strip(),
            "contact": str(row.get("ID LINE/WA/INSTAGRAM (AKTIF)", "")).strip() if pd.notna(row.get("ID LINE/WA/INSTAGRAM (AKTIF)")) else "",
            "items": items,
            "paymentMethod": payment_method,
            "status": existing_status.get(h, "Di Proses"),
            "totalHarga": prev_payment["totalHarga"],
            "sudahBayar": prev_payment["sudahBayar"],
        }
        orders.append(record)

    out = {"orders": orders}
    os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    print(f"Wrote {len(orders)} orders to {OUT_JSON}")


if __name__ == "__main__":
    build()
