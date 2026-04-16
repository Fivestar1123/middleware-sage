import jsPDF from 'jspdf';
import { notoSansKRBase64 } from './notoSansKR';
import autoTable from 'jspdf-autotable';
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, HeadingLevel, BorderStyle, WidthType, ShadingType } from 'docx';
import { saveAs } from 'file-saver';
import type { AnalysisResult } from '@/data/mockLogs';

interface ReportData {
  filename: string;
  analysisResults: AnalysisResult[];
  stats: { critical: number; warning: number; info: number; totalLines: number };
  chatMessages: { role: 'user' | 'assistant'; content: string }[];
}

const now = () => new Date().toLocaleString('ko-KR');

/* ════════════════════════════════════════════
   PDF Generation
   ════════════════════════════════════════════ */

export async function generatePdfReport(data: ReportData) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 15;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  // Embed Korean font
  doc.addFileToVFS('NotoSansKR-Regular.otf', notoSansKRBase64);
  doc.addFont('NotoSansKR-Regular.otf', 'NotoSansKR', 'normal');
  doc.setFont('NotoSansKR');

  const addPage = () => { doc.addPage(); y = margin; };
  const checkPage = (needed: number) => { if (y + needed > 280) addPage(); };

  // ── Title ──
  doc.setFontSize(20);
  doc.setTextColor(30, 64, 175);
  doc.text('LogMind', margin, y + 8);
  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  doc.text('AI Log Analysis Report', margin + 45, y + 8);
  y += 16;

  doc.setDrawColor(30, 64, 175);
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageWidth - margin, y);
  y += 8;

  // ── Section 1: Incident Overview ──
  doc.setFontSize(13);
  doc.setTextColor(30, 30, 30);
  doc.text('1. Incident Overview', margin, y);
  y += 8;

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    theme: 'grid',
    headStyles: { fillColor: [30, 64, 175], fontSize: 9, font: 'NotoSansKR' },
    bodyStyles: { fontSize: 9, font: 'NotoSansKR' },
    columnStyles: { 0: { cellWidth: 40, fontStyle: 'bold' } },
    body: [
      ['Report Date', now()],
      ['Target System', data.filename],
      ['Total Lines', String(data.stats.totalLines)],
      ['Critical', String(data.stats.critical)],
      ['Warning', String(data.stats.warning)],
      ['Info', String(data.stats.info)],
    ],
  });
  y = (doc as any).lastAutoTable.finalY + 10;

  // ── Section 2: AI Analysis Results ──
  checkPage(20);
  doc.setFontSize(13);
  doc.setTextColor(30, 30, 30);
  doc.text('2. AI Analysis Results', margin, y);
  y += 8;

  data.analysisResults.forEach((r, i) => {
    checkPage(50);
    const sevColor: Record<string, [number, number, number]> = {
      critical: [220, 38, 38],
      warning: [234, 179, 8],
      info: [59, 130, 246],
    };
    const color = sevColor[r.severity] || [100, 100, 100];

    doc.setFontSize(10);
    doc.setTextColor(...color);
    doc.text(`[${r.severity.toUpperCase()}] ${r.title}`, margin, y);
    y += 6;

    doc.setFontSize(8);
    doc.setTextColor(60, 60, 60);

    const sections = [
      { label: 'Root Cause:', text: r.cause },
      { label: 'Recommendation:', text: r.recommendation },
      { label: 'Impact:', text: r.impact },
    ];

    sections.forEach(s => {
      checkPage(20);
      doc.setTextColor(30, 30, 30);
      doc.text(s.label, margin + 2, y);
      y += 4;
      doc.setTextColor(80, 80, 80);
      const lines = doc.splitTextToSize(s.text, contentWidth - 4);
      doc.text(lines, margin + 4, y);
      y += lines.length * 3.5 + 2;
    });

    doc.setTextColor(150, 150, 150);
    doc.text(`Related Lines: ${r.relatedLines.join(', ')}`, margin + 2, y);
    y += 8;
  });

  // ── Section 3: Response History ──
  const chatHistory = data.chatMessages.filter((_, i) => i > 0); // Skip system greeting
  if (chatHistory.length > 0) {
    checkPage(20);
    doc.setFontSize(13);
    doc.setTextColor(30, 30, 30);
    doc.text('3. Response History (AI Chat)', margin, y);
    y += 8;

    chatHistory.forEach(msg => {
      checkPage(15);
      const prefix = msg.role === 'user' ? '[User]' : '[AI]';
      doc.setFontSize(8);
      doc.setTextColor(msg.role === 'user' ? 30 : 59, msg.role === 'user' ? 64 : 130, msg.role === 'user' ? 175 : 246);
      doc.text(prefix, margin + 2, y);
      doc.setTextColor(60, 60, 60);
      const lines = doc.splitTextToSize(msg.content, contentWidth - 20);
      doc.text(lines, margin + 18, y);
      y += Math.max(lines.length * 3.5, 5) + 3;
    });
    y += 4;
  }

  // ── Section 4: Action Guide & Prevention ──
  checkPage(20);
  const sectionNum = chatHistory.length > 0 ? '4' : '3';
  doc.setFontSize(13);
  doc.setTextColor(30, 30, 30);
  doc.text(`${sectionNum}. Action Guide & Prevention`, margin, y);
  y += 8;

  const criticals = data.analysisResults.filter(r => r.severity === 'critical');
  const warnings = data.analysisResults.filter(r => r.severity === 'warning');

  if (criticals.length > 0) {
    doc.setFontSize(9);
    doc.setTextColor(220, 38, 38);
    doc.text('Immediate Actions Required:', margin + 2, y);
    y += 5;
    criticals.forEach((r, i) => {
      checkPage(10);
      doc.setFontSize(8);
      doc.setTextColor(60, 60, 60);
      const lines = doc.splitTextToSize(`${i + 1}. ${r.recommendation}`, contentWidth - 8);
      doc.text(lines, margin + 4, y);
      y += lines.length * 3.5 + 2;
    });
    y += 4;
  }

  if (warnings.length > 0) {
    checkPage(15);
    doc.setFontSize(9);
    doc.setTextColor(180, 130, 0);
    doc.text('Prevention Measures:', margin + 2, y);
    y += 5;
    warnings.forEach((r, i) => {
      checkPage(10);
      doc.setFontSize(8);
      doc.setTextColor(60, 60, 60);
      const lines = doc.splitTextToSize(`${i + 1}. ${r.recommendation}`, contentWidth - 8);
      doc.text(lines, margin + 4, y);
      y += lines.length * 3.5 + 2;
    });
  }

  // Footer on each page
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(180, 180, 180);
    doc.text(`LogMind Report - ${now()} - Page ${i}/${pageCount}`, margin, 290);
  }

  doc.save(`LogMind_Report_${new Date().toISOString().slice(0, 10)}.pdf`);
}

/* ════════════════════════════════════════════
   DOCX Generation
   ════════════════════════════════════════════ */

export async function generateDocxReport(data: ReportData) {
  const cellBorder = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
  const cellBorders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };

  const overviewRows = [
    ['Report Date', now()],
    ['Target System', data.filename],
    ['Total Lines', String(data.stats.totalLines)],
    ['Critical', String(data.stats.critical)],
    ['Warning', String(data.stats.warning)],
    ['Info', String(data.stats.info)],
  ];

  const severityColor: Record<string, string> = {
    critical: 'DC2626',
    warning: 'EAB308',
    info: '3B82F6',
  };

  const chatHistory = data.chatMessages.filter((_, i) => i > 0);

  const children: any[] = [];

  // Title
  children.push(
    new Paragraph({
      heading: HeadingLevel.TITLE,
      children: [new TextRun({ text: 'LogMind - AI Log Analysis Report', bold: true, size: 36, color: '1E40AF' })],
    }),
    new Paragraph({ children: [] }),
  );

  // Section 1: Incident Overview
  children.push(
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: '1. Incident Overview', bold: true })] }),
    new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [3000, 6360],
      rows: overviewRows.map(([label, value]) =>
        new TableRow({
          children: [
            new TableCell({
              width: { size: 3000, type: WidthType.DXA },
              borders: cellBorders,
              shading: { fill: 'E8F0FE', type: ShadingType.CLEAR },
              margins: { top: 60, bottom: 60, left: 100, right: 100 },
              children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 20 })] })],
            }),
            new TableCell({
              width: { size: 6360, type: WidthType.DXA },
              borders: cellBorders,
              margins: { top: 60, bottom: 60, left: 100, right: 100 },
              children: [new Paragraph({ children: [new TextRun({ text: value, size: 20 })] })],
            }),
          ],
        })
      ),
    }),
    new Paragraph({ children: [] }),
  );

  // Section 2: AI Analysis Results
  children.push(
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: '2. AI Analysis Results', bold: true })] }),
  );

  data.analysisResults.forEach(r => {
    const color = severityColor[r.severity] || '666666';
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: `[${r.severity.toUpperCase()}] ${r.title}`, color, bold: true })],
      }),
      new Paragraph({ children: [new TextRun({ text: 'Root Cause:', bold: true, size: 20 })] }),
      new Paragraph({ children: [new TextRun({ text: r.cause, size: 20, color: '444444' })] }),
      new Paragraph({ children: [new TextRun({ text: 'Recommendation:', bold: true, size: 20 })] }),
      new Paragraph({ children: [new TextRun({ text: r.recommendation, size: 20, color: '444444' })] }),
      new Paragraph({ children: [new TextRun({ text: 'Impact:', bold: true, size: 20 })] }),
      new Paragraph({ children: [new TextRun({ text: r.impact, size: 20, color: '444444' })] }),
      new Paragraph({ children: [new TextRun({ text: `Related Lines: ${r.relatedLines.join(', ')}`, size: 16, color: '999999' })] }),
      new Paragraph({ children: [] }),
    );
  });

  // Section 3: Response History
  if (chatHistory.length > 0) {
    children.push(
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: '3. Response History (AI Chat)', bold: true })] }),
    );
    chatHistory.forEach(msg => {
      const isUser = msg.role === 'user';
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: isUser ? '[User] ' : '[AI] ', bold: true, size: 20, color: isUser ? '1E40AF' : '3B82F6' }),
            new TextRun({ text: msg.content, size: 20, color: '444444' }),
          ],
        }),
      );
    });
    children.push(new Paragraph({ children: [] }));
  }

  // Section 4: Action Guide & Prevention
  const sectionNum = chatHistory.length > 0 ? '4' : '3';
  children.push(
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: `${sectionNum}. Action Guide & Prevention`, bold: true })] }),
  );

  const criticals = data.analysisResults.filter(r => r.severity === 'critical');
  const warnings = data.analysisResults.filter(r => r.severity === 'warning');

  if (criticals.length > 0) {
    children.push(new Paragraph({ children: [new TextRun({ text: 'Immediate Actions Required:', bold: true, size: 22, color: 'DC2626' })] }));
    criticals.forEach((r, i) => {
      children.push(new Paragraph({ children: [new TextRun({ text: `${i + 1}. ${r.recommendation}`, size: 20, color: '444444' })] }));
    });
    children.push(new Paragraph({ children: [] }));
  }

  if (warnings.length > 0) {
    children.push(new Paragraph({ children: [new TextRun({ text: 'Prevention Measures:', bold: true, size: 22, color: 'B48200' })] }));
    warnings.forEach((r, i) => {
      children.push(new Paragraph({ children: [new TextRun({ text: `${i + 1}. ${r.recommendation}`, size: 20, color: '444444' })] }));
    });
  }

  const docxDoc = new Document({
    styles: {
      default: { document: { run: { font: 'Arial', size: 24 } } },
    },
    sections: [{ children }],
  });

  const buffer = await Packer.toBlob(docxDoc);
  saveAs(buffer, `LogMind_Report_${new Date().toISOString().slice(0, 10)}.docx`);
}
