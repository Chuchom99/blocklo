import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import logger from "../config/logger.js";
import prisma from "../config/prisma.js";

const RECEIPTS_DIR = "./public/receipts";
if (!fs.existsSync(RECEIPTS_DIR)) {
  fs.mkdirSync(RECEIPTS_DIR, { recursive: true });
}

export async function generateTransactionReceiptPDF(data) {
  return new Promise((resolve, reject) => {
    const filename = `receipt_${Date.now()}.pdf`;
    const filepath = path.join(RECEIPTS_DIR, filename);
    const doc = new PDFDocument({ margin: 50 });

    doc.pipe(fs.createWriteStream(filepath));

    // Header
    doc
      .fontSize(20)
      .font("Helvetica-Bold")
      .text("BLOCKLO × 9PSB", 50, 80)
      .fontSize(12)
      .font("Helvetica")
      .text("Transaction Receipt", 50, 120)
      .fontSize(10)
      .text("9 Payment Service Bank", 50, 140);

    // Transaction Details
    doc
      .moveDown()
      .fontSize(14)
      .font("Helvetica-Bold")
      .text("TRANSFER DETAILS", { continued: true })
      .text("✓ SUCCESSFUL", { fillColor: "green" });

    doc
      .moveDown(0.5)
      .fontSize(11)
      .font("Helvetica")
      .text(`Date: ${data.date}`, 50, doc.y)
      .text(`Ref: ${data.transactionRef}`, 300, doc.y);

    doc
      .moveDown()
      .fontSize(12)
      .font("Helvetica-Bold")
      .text("AMOUNT")
      .moveDown()
      .fontSize(24)
      .font("Helvetica-Bold")
      .fillColor("#2E7D32")
      .text(`₦${data.amount.toLocaleString("en-NG")}`, 50, doc.y)
      .fillColor("black");

    doc
      .moveDown(1)
      .fontSize(11)
      .font("Helvetica")
      .text("FROM:", { continued: true })
      .font("Helvetica-Bold")
      .text(data.senderName, { continued: true })
      .font("Helvetica")
      .text(` (${data.senderAccount})`);

    doc
      .moveDown()
      .text("TO:", { continued: true })
      .font("Helvetica-Bold")
      .text(data.recipientName, { continued: true })
      .font("Helvetica")
      .text(` (${data.recipientAccount})`);

    doc
      .moveDown(1)
      .fontSize(11)
      .font("Helvetica")
      .text("Balance After:", { continued: true })
      .font("Helvetica-Bold")
      .text(`₦${data.balanceAfter}`);

    // Footer
    doc
      .moveDown(2)
      .fontSize(8)
      .font("Helvetica")
      .text("Powered by Blocklo × 9PSB", { align: "center" })
      .text("Secure WhatsApp Banking", { align: "center" });

    doc.end();

    doc.on("end", () => {
      logger.info(`PDF receipt generated: ${filepath}`);
      resolve(`/receipts/${filename}`);
    });

    doc.on("error", reject);
  });
}



export async function generateTransactionHistoryPDF({ userId, transactions, page = 1, total = 0 }) {
  try {
    // FETCH USER WITH ACCOUNT — await is now properly used
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { accounts: { take: 1 } },
    });

    if (!user) {
      throw new Error("User not found");
    }

    const account = user.accounts[0];
    const accountNumber = account?.accountNumber || "XXXXXXX";

    const filename = `statement_${Date.now()}.pdf`;
    const filepath = path.join(RECEIPTS_DIR, filename);

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50, size: "A4" });
      const stream = fs.createWriteStream(filepath);

      doc.pipe(stream);

      // === HEADER ===
      doc.fontSize(22).font("Helvetica-Bold").fillColor("#1a5fb4").text("BLOCKLO × 9PSB", 50, 60);
      doc.moveDown(0.5);
      doc.fontSize(16).fillColor("black").text("Mini Statement", 50, doc.y);
      doc.fontSize(10).text(`Account: ${accountNumber}`, 50, doc.y + 20);
      doc.text(`Name: ${user.firstName} ${user.lastName || ""}`.trim(), 50, doc.y + 15);
      doc.text(`Generated: ${new Date().toLocaleString("en-NG")}`, 50, doc.y + 15);
      doc.moveDown(3);

      // === TABLE HEADER ===
      const startY = doc.y;
      doc.fontSize(10).font("Helvetica-Bold");
      doc.text("Date", 50, startY);
      doc.text("Description", 130, startY);
      doc.text("Amount", 350, startY, { width: 100, align: "right" });
      doc.text("Status", 460, startY);
      doc.moveTo(50, startY + 15).lineTo(550, startY + 15).stroke();

      // === TRANSACTIONS ===
      doc.font("Helvetica").fontSize(9);
      let y = startY + 25;

      transactions.forEach((t) => {
        const desc = (t.description || t.destinationName || t.reference?.slice(-12) || "Transaction").slice(0, 35);
        const amountText = t.type === "CREDIT"
          ? `+₦${Number(t.amount).toLocaleString()}`
          : `-₦${Number(t.amount).toLocaleString()}`;

        doc.text(new Date(t.createdAt).toLocaleDateString("en-NG"), 50, y);
        doc.text(desc, 130, y);
        doc.fillColor(t.type === "CREDIT" ? "green" : "red")
           .text(amountText, 350, y, { width: 100, align: "right" });
        doc.fillColor("black").text(t.status || "PENDING", 460, y);

        y += 20;
        if (y > 750) {
          doc.addPage();
          y = 50;
        }
      });

      // === FOOTER ===
      doc.fontSize(10)
         .text(`Page ${page} • Total Transactions: ${total}`, 50, 780, { align: "center" });

      // === FINALIZE ===
      doc.end();

      stream.on("finish", () => {
        logger.info(`Statement PDF generated: ${filepath}`);
        resolve(`/receipts/${filename}`);
      });

      stream.on("error", (err) => {
        logger.error("PDF write stream error:", err);
        reject(err);
      });

      doc.on("error", reject);
    });

  } catch (error) {
    logger.error("Failed to generate transaction history PDF:", error);
    throw error;
  }
}