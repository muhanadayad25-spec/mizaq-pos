(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MizaqPrintDocuments = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
  }

  function buildDocument(kind, value) {
    if (!["kitchen", "receipt", "test"].includes(kind)) throw new TypeError("Unknown print document type.");
    const ticket = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const lines = Array.isArray(ticket.lines) ? ticket.lines : [];
    const kitchen = kind === "kitchen";
    const test = kind === "test";
    const rows = lines.map((line) => {
      const name = escapeHtml(line.productName || line.name || "صنف");
      const qty = escapeHtml(line.qty);
      return kitchen
        ? `<tr><td>${name}</td><td>${qty}</td></tr>`
        : `<tr><td>${name}</td><td>${qty}</td><td>${escapeHtml(line.unitPrice)}</td><td>${escapeHtml(line.lineTotal)}</td></tr>`;
    }).join("");
    const headers = kitchen ? "<th>الصنف</th><th>الكمية</th>" : "<th>الصنف</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th>";
    const title = test ? "اختبار الطباعة" : kitchen ? "تذكرة المطبخ" : "فاتورة العميل";
    const numberLabel = kitchen || test ? "رقم الطلب" : "رقم الفاتورة";
    const documentNumber = escapeHtml(kitchen || test ? ticket.orderId || ticket.id || "—" : ticket.id || "—");
    const orderNumber = !kitchen && !test && ticket.orderId ? `<p>رقم الطلب: ${escapeHtml(ticket.orderId)}</p>` : "";
    const table = escapeHtml(ticket.table || "—");
    const waiter = escapeHtml(ticket.waiterName || "—");
    const notes = ticket.notes ? `<p>ملاحظات: ${escapeHtml(ticket.notes)}</p>` : "";
    const financial = kitchen || test ? "" : `${ticket.void ? '<div class="status">فاتورة ملغاة</div>' : ""}<p>طريقة الدفع: ${escapeHtml(ticket.payment || "—")}</p><div class="total">الإجمالي: ${escapeHtml(ticket.total || 0)}</div>`;
    const sample = test ? `<tr><td>صنف تجريبي</td><td>1</td>${kitchen ? "" : "<td>0</td><td>0</td>"}</tr>` : "";

    return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';"><title>${title}</title><style>@page{size:80mm auto;margin:4mm}body{font:12px Tahoma,Arial,sans-serif;width:72mm;margin:0 auto;color:#000}h1{text-align:center;font-size:18px}p{margin:4px 0}.status{text-align:center;border:1px solid #555;padding:4px} .total{font-weight:bold;font-size:15px;margin-top:8px}table{width:100%;border-collapse:collapse;margin:8px 0}th,td{text-align:right;padding:4px 2px;border-bottom:1px dashed #888}</style></head><body><h1>MIZAQ POS</h1><div class="status">${title}</div><p>${numberLabel}: ${documentNumber}</p>${orderNumber}${kitchen || test ? `<p>الطاولة: ${table}</p><p>الويتر: ${waiter}</p>` : `<p>الويتر: ${waiter}</p>`}${notes}<table><thead><tr>${headers}</tr></thead><tbody>${rows || sample}</tbody></table>${financial}</body></html>`;
  }

  return { buildDocument };
});
