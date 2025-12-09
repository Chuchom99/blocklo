// utils/pdf.vas.receipt.js
import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";

const RECEIPTS_DIR = "./public/receipts";
if (!fs.existsSync(RECEIPTS_DIR))
  fs.mkdirSync(RECEIPTS_DIR, { recursive: true });

export const generateVasReceipt = (data) => {
  return new Promise((resolve, reject) => {
    const filename = `vas_${data.ref}_${Date.now()}.pdf`;
    const filepath = path.join(RECEIPTS_DIR, filename);
    const doc = new PDFDocument({ margin: 50 });

    const stream = fs.createWriteStream(filepath);
    doc.pipe(stream);

    // Header
    doc.fontSize(20).font("Helvetica-Bold").text("BLOCKLO × 9PSB", 50, 80);
    doc.fontSize(14).text("VAS Receipt", 50, 120);
    doc.fontSize(10).text(`Ref: ${data.ref}`, 50, 145);
    doc.text(`Date: ${new Date().toLocaleString("en-NG")}`, 50, 160);

    doc.moveDown(3);

    // Success Badge
    doc.fontSize(16).fillColor("green").text("SUCCESSFUL", 50, doc.y);
    doc.fillColor("black");

    // Details
    doc.fontSize(12).text(`Service: ${data.service}`, { continued: true });
    doc
      .fontSize(18)
      .font("Helvetica-Bold")
      .fillColor("#2E7D32")
      .text(` ₦${data.amount.toLocaleString()}`, { align: "right" });

    doc.moveDown();
    doc
      .fontSize(11)
      .text(`To: ${data.networkEmoji} ${data.phoneNumber}`)
      .text(`Account: ${data.accountNumber}`)
      .text(`Name: ${data.customerName}`);

    if (data.token) {
      doc
        .fontSize(16)
        .font("Helvetica-Bold")
        .fillColor("#2E7D32")
        .text(`TOKEN: ${data.token}`, 50, doc.y + 20);
    }

    doc.moveDown(2);
    doc.fontSize(10).text("Thank you for using Blocklo!", { align: "center" });

    doc.end();

    stream.on("finish", () => resolve(`/receipts/${filename}`));
    stream.on("error", reject);
  });
};
