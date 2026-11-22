const PDFDocument = require('pdfkit');
const fs = require('fs');
const { summaryToText, summaryToMarkdown, formatTopicTime } = require('./summarize');

/** @typedef {import('./summarize').Summary} Summary */

/**
 * @param {string} transcript @param {string} title @param {string} outputPath
 * @param {Summary | null} [summary]
 */
async function exportPDF(transcript, title, outputPath, summary = null) {
  return /** @type {Promise<void>} */ (new Promise((resolve, reject) => {
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

    if (summary) {
      doc.font('Times-Bold').fontSize(14).fillColor('#1a1a1a').text('Summary');
      doc.moveDown(0.3);
      doc.font('Times-Roman').fontSize(12).text(summary.overview, { lineGap: 4 });
      doc.moveDown(0.4);
      for (const t of summary.topics) {
        const time = formatTopicTime(t.startSec);
        doc.text(`•  ${time ? `${time}  ` : ''}${t.title}`, { lineGap: 2 });
      }
      doc.moveDown(0.8);
      doc
        .moveTo(72, doc.y)
        .lineTo(doc.page.width - 72, doc.y)
        .strokeColor('#cccccc')
        .lineWidth(0.5)
        .stroke();
      doc.moveDown(0.8);
    }

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
  }));
}

/**
 * @param {string} transcript @param {string} title @param {string} outputPath
 * @param {Summary | null} [summary]
 */
async function exportDOCX(transcript, title, outputPath, summary = null) {
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

  const run = (text, extra = {}) => new TextRun({ text, size: 24, font: 'Times New Roman', ...extra });
  const summaryParagraphs = summary ? [
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [run('Summary', { bold: true, size: 28 })],
      spacing: { after: 120 },
    }),
    new Paragraph({ children: [run(summary.overview)], spacing: { after: 120 } }),
    ...summary.topics.map((t) => {
      const time = formatTopicTime(t.startSec);
      return new Paragraph({
        children: [run('•  '), ...(time ? [run(`${time}  `, { bold: true })] : []), run(t.title)],
        spacing: { after: 60 },
      });
    }),
    new Paragraph({ children: [], spacing: { after: 240 } }),
  ] : [];

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
        ...summaryParagraphs,
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
    // Produce a single-segment SRT covering the whole file. A blank line
    // ends an SRT cue, so paragraph breaks become single line breaks.
    const body = transcript.trim().replace(/\n\s*\n/g, '\n');
    return `1\n00:00:00,000 --> 00:00:00,001\n${body}\n`;
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

/**
 * @param {string} transcript @param {string} title
 * @param {Summary | null} [summary]
 */
function exportMarkdown(transcript, title, summary = null) {
  const dateStr = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
  const summaryBlock = summary ? `${summaryToMarkdown(summary)}\n` : '';
  return `# ${title}\n\n*Transcribed on ${dateStr}*\n\n${summaryBlock}---\n\n${transcript.trim()}\n`;
}

/**
 * Plain-text export: the summary (when there is one) above the transcript.
 * @param {string} transcript
 * @param {Summary | null} [summary]
 */
function buildTxt(transcript, summary = null) {
  return summary ? `${summaryToText(summary)}\n${transcript}` : transcript;
}

module.exports = { exportPDF, exportDOCX, exportSRT, exportMarkdown, buildTxt };
