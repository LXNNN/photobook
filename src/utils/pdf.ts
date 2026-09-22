import jsPDF from 'jspdf';
import type { Project, Page, ExportConfig } from '@/types';
import { mmToPx } from './units';

/**
 * 导出项目为 PDF
 * 每页用离屏 Canvas 渲染后嵌入 PDF
 */
export async function exportToPDF(
  project: Project,
  config: ExportConfig,
  renderPage: (page: Page, widthPx: number, heightPx: number, includeBleed: boolean) => Promise<HTMLCanvasElement>
): Promise<void> {
  const { format } = project;
  const dpi = config.dpi;

  // PDF 页面尺寸（含出血时加大）
  const pageWidthMm = config.includeBleed ? format.width + format.bleed * 2 : format.width;
  const pageHeightMm = config.includeBleed ? format.height + format.bleed * 2 : format.height;

  // 渲染像素尺寸
  const renderWidth = Math.round(mmToPx(pageWidthMm, dpi));
  const renderHeight = Math.round(mmToPx(pageHeightMm, dpi));

  const pdf = new jsPDF({
    orientation: pageWidthMm > pageHeightMm ? 'landscape' : 'portrait',
    unit: 'mm',
    format: [pageWidthMm, pageHeightMm],
    compress: true,
  });

  for (let i = 0; i < project.pages.length; i++) {
    const page = project.pages[i];
    const canvas = await renderPage(page, renderWidth, renderHeight, config.includeBleed);
    const imgData = canvas.toDataURL('image/jpeg', 0.95);

    if (i > 0) {
      pdf.addPage([pageWidthMm, pageHeightMm], pageWidthMm > pageHeightMm ? 'landscape' : 'portrait');
    }
    pdf.addImage(imgData, 'JPEG', 0, 0, pageWidthMm, pageHeightMm);
  }

  pdf.save(`${project.name || 'photo-book'}.pdf`);
}
