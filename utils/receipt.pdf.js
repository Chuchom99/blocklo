import PDFDocument from "pdfkit";

// PDFs are rendered in memory from ledger rows and never written to disk,
// so there is no public directory of customer receipts to leak.

const naira = (n) => `NGN ${Number(n).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const mask = (acct) => (acct ? `******${String(acct).slice(-4)}` : "-");

const KIND_LABEL = { TRANSFER: "Transfer", AIRTIME: "Airtime top-up", DATA: "Data bundle", BILL: "Bill payment", INFLOW: "Incoming transfer", OTHER: "Transaction" };

function toBuffer(build) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    build(doc);
    doc.end();
  });
}

const header = (doc, title) => {
  doc.fontSize(20).font("Helvetica-Bold").text("BLOCKLO x 9PSB");
  doc.fontSize(12).font("Helvetica").text(title).moveDown();
};

const row = (doc, label, value) => {
  doc.font("Helvetica-Bold").text(`${label}: `, { continued: true }).font("Helvetica").text(String(value ?? "-"));
};

// details: optional extra rows, e.g. { "Meter": "...", "Token": "..." }
export function renderReceipt(tx, { customerName, sourceAccount, details = {} } = {}) {
  return toBuffer((doc) => {
    header(doc, `${KIND_LABEL[tx.kind] || "Transaction"} receipt`);
    doc.fontSize(16).fillColor(tx.status === "SUCCESS" ? "#2E7D32" : "#B26A00").text(tx.status).fillColor("black").moveDown(0.5);
    doc.fontSize(22).font("Helvetica-Bold").text(naira(tx.amount)).moveDown();
    doc.fontSize(11);
    row(doc, "Reference", tx.reference);
    row(doc, "Date", new Date(tx.createdAt).toLocaleString("en-NG", { timeZone: "Africa/Lagos" }));
    row(doc, "From", `${customerName || "-"} (${mask(sourceAccount)})`);
    if (tx.destinationAccount) row(doc, "To", `${tx.destinationName || "-"} (${mask(tx.destinationAccount)})`);
    if (tx.description) row(doc, "Description", tx.description);
    for (const [label, value] of Object.entries(details)) row(doc, label, value);
    doc.moveDown(2).fontSize(8).text("Secure WhatsApp banking by Blocklo x 9PSB", { align: "center" });
  });
}

export function renderStatement({ customerName, accountNumber, transactions }) {
  return toBuffer((doc) => {
    header(doc, "Mini statement");
    doc.fontSize(11);
    row(doc, "Account", `${customerName} (${mask(accountNumber)})`);
    row(doc, "Generated", new Date().toLocaleString("en-NG", { timeZone: "Africa/Lagos" }));
    doc.moveDown();
    for (const t of transactions) {
      const sign = t.type === "CREDIT" ? "+" : "-";
      doc
        .font("Helvetica")
        .text(
          `${new Date(t.createdAt).toLocaleDateString("en-NG")}  ${sign}${naira(t.amount)}  ${t.status}  ${t.description || t.destinationName || t.reference}`,
        );
    }
  });
}
