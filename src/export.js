const PDFDocument = require('pdfkit');
const fs = require('fs');

async function exportPDF(transcript, title, outputPath) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: 72, bottom: 72, left: 72, right: 72 },
      bufferPages: true, // keep all pages addressable for the page-number pass
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

async function exportDOCX(transcript, title, outputPath) {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = require('docx');

  const dateStr = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  const bodyParagraphs = transcript.split('\n').map(line =>
    new Paragraph({
      children: [new TextRun({ text: line, size: 24, font: 'Times New Roman' })],
      spacing: { after: 120 },
    })
  );

  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun({ text: title, bold: true, size: 48, font: 'Times New Roman' })],
          spacing: { after: 80 },
        }),
        new Paragraph({
          children: [new TextRun({ text: `Transcribed on ${dateStr}`, color: '666666', size: 20, italics: true, font: 'Times New Roman' })],
          spacing: { after: 240 },
        }),
        ...bodyParagraphs,
      ],
    }],
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outputPath, buffer);
}

function exportSRT(transcript) {
  const lines = transcript.split('\n').filter(Boolean);
  // Detect timestamp format: [HH:MM:SS.mmm --> HH:MM:SS.mmm]
  const tsPattern = /^\[(\d{2}:\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}:\d{2}\.\d{3})\]\s*(.*)/;
  const hasTimestamps = lines.some(l => tsPattern.test(l));

  if (!hasTimestamps) {
    // Produce a single-segment SRT covering the whole file
    return `1\n00:00:00,000 --> 00:00:00,001\n${transcript.trim()}\n`;
  }

  return lines
    .map(line => tsPattern.exec(line))
    .filter(Boolean)
    .map(([, start, end, text], i) => {
      const srtStart = start.replace('.', ',');
      const srtEnd   = end.replace('.', ',');
      return `${i + 1}\n${srtStart} --> ${srtEnd}\n${text.trim()}`;
    })
    .join('\n\n') + '\n';
}

function exportMarkdown(transcript, title) {
  const dateStr = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
  return `# ${title}\n\n*Transcribed on ${dateStr}*\n\n---\n\n${transcript.trim()}\n`;
}

module.exports = { exportPDF, exportDOCX, exportSRT, exportMarkdown };
