import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { registerKoreanPdfFont } from './pdfFont';
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, HeadingLevel, BorderStyle, WidthType, ShadingType } from 'docx';
import { saveAs } from 'file-saver';
import { supabase } from '@/integrations/supabase/client';
import type { AnalysisResult } from '@/data/mockLogs';

interface ReportData {
  filename: string;
  analysisResults: AnalysisResult[];
  stats: { critical: number; warning: number; info: number; totalLines: number };
  chatMessages: { role: 'user' | 'assistant'; content: string }[];
}

interface ChatSummary {
  question: string;
  cause: string;
  action: string;
  impact: string;
}

const now = () => new Date().toLocaleString('ko-KR');

/** Pair user→assistant messages and request server-side summarization. */
async function summarizeChatHistory(
  chatMessages: ReportData['chatMessages']
): Promise<ChatSummary[]> {
  const pairs: { question: string; answer: string }[] = [];
  for (let i = 0; i < chatMessages.length; i++) {
    const m = chatMessages[i];
    if (m.role !== 'user') continue;
    const next = chatMessages[i + 1];
    if (next && next.role === 'assistant') {
      pairs.push({ question: m.content, answer: next.content });
    }
  }
  if (pairs.length === 0) return [];

  try {
    const { data, error } = await supabase.functions.invoke('summarize-chat', {
      body: { qaPairs: pairs },
    });
    if (error) throw error;
    const summaries = (data as any)?.summaries;
    if (Array.isArray(summaries) && summaries.length > 0) return summaries as ChatSummary[];
  } catch (e) {
    console.warn('[reportGenerator] chat summarize failed, falling back to raw:', e);
  }
  // Fallback: raw text
  return pairs.map((p) => ({
    question: p.question,
    cause: '요약 생성 실패 - 원본 답변 참조',
    action: p.answer,
    impact: '해당 없음',
  }));
}

/* ════════════════════════════════════════════
   PDF Generation
   ════════════════════════════════════════════ */

export async function generatePdfReport(data: ReportData) {
  // Pre-compute chat summaries (async) before drawing PDF
  const chatSummaries = await summarizeChatHistory(data.chatMessages.filter((_, i) => i > 0));

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 15;
  const bottomMargin = 20; // reserve for footer
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  const koreanFontName = await registerKoreanPdfFont(doc);

  const addPage = () => { doc.addPage(); y = margin; };
  const checkPage = (needed: number) => {
    if (y + needed > pageHeight - bottomMargin) addPage();
  };

  /** Draw wrapped text line-by-line with per-line page-break checks. */
  const drawWrappedText = (
    text: string,
    x: number,
    opts: { fontSize: number; color: [number, number, number]; maxWidth: number; lineHeight?: number }
  ) => {
    const lh = opts.lineHeight ?? opts.fontSize * 0.45;
    doc.setFontSize(opts.fontSize);
    doc.setTextColor(...opts.color);
    const paragraphs = (text || '').replace(/\\n/g, '\n').split('\n');
    paragraphs.forEach((para) => {
      const trimmed = para.trim();
      if (!trimmed) { y += lh * 0.6; return; }
      const lines = doc.splitTextToSize(trimmed, opts.maxWidth);
      lines.forEach((ln: string) => {
        checkPage(lh + 1);
        doc.text(ln, x, y);
        y += lh;
      });
      y += 1;
    });
  };

  // ── Title ──
  doc.setFontSize(20);
  doc.setTextColor(30, 64, 175);
  doc.text('LogMind', margin, y + 8);
  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  doc.text('AI Log Analysis Report', margin + 45, y + 8);

  // FINAL badge (top-right)
  doc.setFillColor(30, 64, 175);
  doc.roundedRect(pageWidth - margin - 28, y + 2, 28, 8, 1.5, 1.5, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(9);
  doc.text('FINAL v1.0', pageWidth - margin - 24, y + 7.6);
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

  const patternCounts = {
    critical: data.analysisResults.filter(r => r.severity === 'critical').length,
    warning: data.analysisResults.filter(r => r.severity === 'warning').length,
    info: data.analysisResults.filter(r => r.severity === 'info').length,
  };

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    theme: 'grid',
    headStyles: { fillColor: [30, 64, 175], fontSize: 9, font: koreanFontName },
    bodyStyles: { fontSize: 9, font: koreanFontName },
    columnStyles: { 0: { cellWidth: 50, fontStyle: 'bold' } },
    body: [
      ['Document Status', 'FINAL v1.0 (최종 버전)'],
      ['Report Date', now()],
      ['Target System', data.filename],
      ['Total Lines', String(data.stats.totalLines)],
      ['Critical (lines / patterns)', `${data.stats.critical} lines / ${patternCounts.critical} patterns`],
      ['Warning (lines / patterns)', `${data.stats.warning} lines / ${patternCounts.warning} patterns`],
      ['Info (lines / patterns)', `${data.stats.info} lines / ${patternCounts.info} patterns`],
    ],
  });
  y = (doc as any).lastAutoTable.finalY + 10;

  // ── Section 2: AI Analysis Results ──
  checkPage(20);
  doc.setFontSize(13);
  doc.setTextColor(30, 30, 30);
  doc.text('2. AI Analysis Results', margin, y);
  y += 8;

  data.analysisResults.forEach((r) => {
    const sevColor: Record<string, [number, number, number]> = {
      critical: [220, 38, 38],
      warning: [234, 179, 8],
      info: [59, 130, 246],
    };
    const color = sevColor[r.severity] || [100, 100, 100];

    checkPage(14);
    doc.setFontSize(10);
    doc.setTextColor(...color);
    doc.text(`[${r.severity.toUpperCase()}] ${r.title}`, margin, y);
    y += 6;

    const sections = [
      { label: 'Root Cause:', text: r.cause },
      { label: 'Recommendation:', text: r.recommendation },
      { label: 'Impact:', text: r.impact },
    ];

    sections.forEach((s) => {
      checkPage(10);
      doc.setFontSize(8);
      doc.setTextColor(30, 30, 30);
      doc.text(s.label, margin + 2, y);
      y += 4;
      drawWrappedText(s.text, margin + 4, {
        fontSize: 8,
        color: [80, 80, 80],
        maxWidth: contentWidth - 4,
      });
      y += 1;
    });

    checkPage(8);
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text(`Related Lines: ${r.relatedLines.join(', ')}`, margin + 2, y);
    y += 8;
  });

  // ── Section 3: Response History (summarized) ──
  if (chatSummaries.length > 0) {
    checkPage(20);
    doc.setFontSize(13);
    doc.setTextColor(30, 30, 30);
    doc.text('3. Response History (AI Chat - Summary)', margin, y);
    y += 8;

    chatSummaries.forEach((s, idx) => {
      checkPage(14);
      doc.setFontSize(10);
      doc.setTextColor(30, 64, 175);
      doc.text(`Q${idx + 1}. ${s.question}`, margin, y);
      y += 6;

      const fields: { label: string; text: string }[] = [
        { label: 'Cause:', text: s.cause },
        { label: 'Action:', text: s.action },
        { label: 'Impact:', text: s.impact },
      ];
      fields.forEach((f) => {
        checkPage(10);
        doc.setFontSize(8);
        doc.setTextColor(30, 30, 30);
        doc.text(f.label, margin + 2, y);
        y += 4;
        drawWrappedText(f.text, margin + 4, {
          fontSize: 8,
          color: [80, 80, 80],
          maxWidth: contentWidth - 4,
        });
        y += 1;
      });
      y += 4;
    });
  }

  // ── Section 4: Action Guide & Prevention ──
  checkPage(20);
  const sectionNum = chatSummaries.length > 0 ? '4' : '3';
  doc.setFontSize(13);
  doc.setTextColor(30, 30, 30);
  doc.text(`${sectionNum}. Action Guide & Prevention`, margin, y);
  y += 8;

  const criticals = data.analysisResults.filter(r => r.severity === 'critical');
  const warnings = data.analysisResults.filter(r => r.severity === 'warning');

  if (criticals.length > 0) {
    checkPage(10);
    doc.setFontSize(9);
    doc.setTextColor(220, 38, 38);
    doc.text('Immediate Actions Required:', margin + 2, y);
    y += 5;
    criticals.forEach((r, i) => {
      drawWrappedText(`${i + 1}. ${r.recommendation}`, margin + 4, {
        fontSize: 8,
        color: [60, 60, 60],
        maxWidth: contentWidth - 8,
      });
      y += 1;
    });
    y += 3;
  }

  if (warnings.length > 0) {
    checkPage(10);
    doc.setFontSize(9);
    doc.setTextColor(180, 130, 0);
    doc.text('Prevention Measures:', margin + 2, y);
    y += 5;
    warnings.forEach((r, i) => {
      drawWrappedText(`${i + 1}. ${r.recommendation}`, margin + 4, {
        fontSize: 8,
        color: [60, 60, 60],
        maxWidth: contentWidth - 8,
      });
      y += 1;
    });
  }

  // Footer on each page
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(180, 180, 180);
    doc.text(`LogMind Report [FINAL v1.0] - ${now()} - Page ${i}/${pageCount}`, margin, pageHeight - 8);
  }

  doc.save(`LogMind_Report_FINAL_v1.0_${new Date().toISOString().slice(0, 10)}.pdf`);
}

/* ════════════════════════════════════════════
   DOCX Generation
   ════════════════════════════════════════════ */

export async function generateDocxReport(data: ReportData) {
  const cellBorder = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
  const cellBorders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };

  const patternCounts = {
    critical: data.analysisResults.filter(r => r.severity === 'critical').length,
    warning: data.analysisResults.filter(r => r.severity === 'warning').length,
    info: data.analysisResults.filter(r => r.severity === 'info').length,
  };

  const overviewRows = [
    ['Document Status', 'FINAL v1.0 (최종 버전)'],
    ['Report Date', now()],
    ['Target System', data.filename],
    ['Total Lines', String(data.stats.totalLines)],
    ['Critical (lines / patterns)', `${data.stats.critical} lines / ${patternCounts.critical} patterns`],
    ['Warning (lines / patterns)', `${data.stats.warning} lines / ${patternCounts.warning} patterns`],
    ['Info (lines / patterns)', `${data.stats.info} lines / ${patternCounts.info} patterns`],
  ];

  const severityColor: Record<string, string> = {
    critical: 'DC2626',
    warning: 'EAB308',
    info: '3B82F6',
  };

  const chatSummaries = await summarizeChatHistory(data.chatMessages.filter((_, i) => i > 0));

  const children: any[] = [];

  // Title
  children.push(
    new Paragraph({
      heading: HeadingLevel.TITLE,
      children: [new TextRun({ text: 'LogMind - AI Log Analysis Report', bold: true, size: 36, color: '1E40AF' })],
    }),
    new Paragraph({
      children: [new TextRun({ text: 'FINAL v1.0 (최종 버전)', bold: true, size: 22, color: 'FFFFFF', highlight: 'darkBlue' })],
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

  // Body paragraphs: keep lines together within a paragraph (no mid-paragraph page break).
  const textToParagraphs = (
    text: string,
    opts: { size: number; color: string; keepNext?: boolean }
  ) =>
    text.replace(/\\n/g, '\n').split('\n').filter(l => l.trim()).map(
      (line, i, arr) => new Paragraph({
        keepLines: true,
        keepNext: opts.keepNext ?? (i < arr.length - 1),
        children: [new TextRun({ text: line.trim(), size: opts.size, color: opts.color })],
      })
    );

  // Bold label paragraph that must stay attached to its body content below.
  const labelParagraph = (label: string) =>
    new Paragraph({
      keepLines: true,
      keepNext: true,
      children: [new TextRun({ text: label, bold: true, size: 20 })],
    });

  data.analysisResults.forEach(r => {
    const color = severityColor[r.severity] || '666666';
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        keepLines: true,
        keepNext: true,
        children: [new TextRun({ text: `[${r.severity.toUpperCase()}] ${r.title}`, color, bold: true })],
      }),
      labelParagraph('Root Cause:'),
      ...textToParagraphs(r.cause, { size: 20, color: '444444' }),
      labelParagraph('Recommendation:'),
      ...textToParagraphs(r.recommendation, { size: 20, color: '444444' }),
      labelParagraph('Impact:'),
      ...textToParagraphs(r.impact, { size: 20, color: '444444' }),
      new Paragraph({
        keepLines: true,
        children: [new TextRun({ text: `Related Lines: ${r.relatedLines.join(', ')}`, size: 16, color: '999999' })],
      }),
      new Paragraph({ children: [] }),
    );
  });

  // Section 3: Response History (summarized)
  if (chatSummaries.length > 0) {
    children.push(
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: '3. Response History (AI Chat - Summary)', bold: true })] }),
    );
    chatSummaries.forEach((s, idx) => {
      children.push(
        // Question heading must stay attached to first body label below
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          keepLines: true,
          keepNext: true,
          children: [new TextRun({ text: `Q${idx + 1}. ${s.question}`, bold: true, color: '1E40AF' })],
        }),
        labelParagraph('Cause:'),
        ...textToParagraphs(s.cause, { size: 20, color: '444444' }),
        labelParagraph('Action:'),
        ...textToParagraphs(s.action, { size: 20, color: '444444' }),
        labelParagraph('Impact:'),
        ...textToParagraphs(s.impact, { size: 20, color: '444444' }),
        new Paragraph({ children: [] }),
      );
    });
  }

  // Section 4: Action Guide & Prevention
  const sectionNum = chatSummaries.length > 0 ? '4' : '3';
  children.push(
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: `${sectionNum}. Action Guide & Prevention`, bold: true })] }),
  );

  const criticals = data.analysisResults.filter(r => r.severity === 'critical');
  const warnings = data.analysisResults.filter(r => r.severity === 'warning');

  if (criticals.length > 0) {
    children.push(new Paragraph({ children: [new TextRun({ text: 'Immediate Actions Required:', bold: true, size: 22, color: 'DC2626' })] }));
    criticals.forEach((r, i) => {
      textToParagraphs(`${i + 1}. ${r.recommendation}`, { size: 20, color: '444444' }).forEach(p => children.push(p));
    });
    children.push(new Paragraph({ children: [] }));
  }

  if (warnings.length > 0) {
    children.push(new Paragraph({ children: [new TextRun({ text: 'Prevention Measures:', bold: true, size: 22, color: 'B48200' })] }));
    warnings.forEach((r, i) => {
      textToParagraphs(`${i + 1}. ${r.recommendation}`, { size: 20, color: '444444' }).forEach(p => children.push(p));
    });
  }

  const docxDoc = new Document({
    styles: {
      default: { document: { run: { font: 'Arial', size: 24 } } },
    },
    sections: [{ children }],
  });

  const buffer = await Packer.toBlob(docxDoc);
  saveAs(buffer, `LogMind_Report_FINAL_v1.0_${new Date().toISOString().slice(0, 10)}.docx`);
}
