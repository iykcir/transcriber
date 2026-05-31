const PDFDocument = require('pdfkit');
const fs = require('fs');

async function exportPDF(transcript, title, outputPath) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: 72, bottom: 72, left: 72, right: 72 },
    });

    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);

    const dateStr = new Date().toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    });

    // Title
    doc
      .font('Times-Bold')
      .fontSize(20)
      .text(title, { align: 'left' });

    doc.moveDown(0.4);

    // Date line
    doc
      .font('Times-Roman')
      .fontSize(11)
      .fillColor('#666666')
      .text(`Transcribed on ${dateStr}`, { align: 'left' });

    // Divider
    doc.moveDown(0.8);
    doc
      .moveTo(72, doc.y)
      .lineTo(doc.page.width - 72, doc.y)
      .strokeColor('#cccccc')
      .lineWidth(0.5)
      .stroke();
    doc.moveDown(0.8);

    // Body text
    doc
      .font('Times-Roman')
      .fontSize(12)
      .fillColor('#1a1a1a')
      .text(transcript, {
        align: 'left',
        lineGap: 4,
      });

    // Page numbers
    const totalPages = doc.bufferedPageRange ? doc.bufferedPageRange().count : 1;
    const range = doc.bufferedPageRange ? doc.bufferedPageRange() : null;
    if (range) {
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        doc
          .font('Times-Roman')
          .fontSize(10)
          .fillColor('#999999')
          .text(
            `Page ${i - range.start + 1} of ${range.count}`,
            72,
            doc.page.height - 50,
            { align: 'center', width: doc.page.width - 144 }
          );
      }
    }

    doc.end();

    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

module.exports = { exportPDF };
