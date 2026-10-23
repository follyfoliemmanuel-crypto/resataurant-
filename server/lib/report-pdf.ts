import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import {
  formatDateFr,
  formatDateTimeFr,
  formatWeekLabel,
  type WeeklyReportData,
} from "./reports.js";

const WIDTH = 595.28;
const HEIGHT = 841.89;
const MARGIN = 44;
const CONTENT_WIDTH = WIDTH - MARGIN * 2;

const ORANGE = rgb(0.918, 0.345, 0.047);
const ORANGE_SOFT = rgb(0.996, 0.953, 0.925);
const DARK = rgb(0.109, 0.098, 0.09);
const MUTED = rgb(0.47, 0.44, 0.42);
const LINE = rgb(0.91, 0.89, 0.87);
const SOFT_BG = rgb(0.98, 0.98, 0.97);
const GREEN = rgb(0.02, 0.59, 0.41);
const WHITE = rgb(1, 1, 1);

type ReportContext = {
  doc: PDFDocument;
  data: WeeklyReportData;
  regular: PDFFont;
  bold: PDFFont;
  page: PDFPage;
  pageNumber: number;
  y: number;
};

type TableColumn = {
  header: string;
  width: number;
  align?: "left" | "right" | "center";
};

type TableRow = string[];

function clean(text: string): string {
  return String(text ?? "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[\u00A0\u202F]/g, " ")
    .replace(/œ/g, "oe")
    .replace(/Œ/g, "OE");
}

function formatMoney(value: number, currency: string): string {
  const noDecimals = currency === "XOF" || currency === "XAF";
  const formatted = new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: noDecimals ? 0 : 2,
    maximumFractionDigits: noDecimals ? 0 : 2,
  })
    .format(value)
    .replace(/[\u00A0\u202F]/g, " ");
  return `${formatted} ${currency}`;
}

function fitText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string {
  const safe = clean(text);
  if (font.widthOfTextAtSize(safe, size) <= maxWidth) return safe;
  let truncated = safe;
  while (
    truncated.length > 1 &&
    font.widthOfTextAtSize(`${truncated}...`, size) > maxWidth
  ) {
    truncated = truncated.slice(0, -1);
  }
  return `${truncated}...`;
}

function drawText(
  ctx: ReportContext,
  text: string,
  x: number,
  y: number,
  size: number,
  font: PDFFont,
  color = DARK,
  maxWidth?: number,
) {
  ctx.page.drawText(maxWidth ? fitText(text, font, size, maxWidth) : clean(text), {
    x,
    y,
    size,
    font,
    color,
  });
}

function drawRightText(
  ctx: ReportContext,
  text: string,
  xRight: number,
  y: number,
  size: number,
  font: PDFFont,
  color = DARK,
) {
  const safe = clean(text);
  ctx.page.drawText(safe, {
    x: xRight - font.widthOfTextAtSize(safe, size),
    y,
    size,
    font,
    color,
  });
}

function drawTopBar(page: PDFPage, height: number) {
  page.drawRectangle({
    x: 0,
    y: HEIGHT - height,
    width: WIDTH,
    height,
    color: ORANGE,
  });
}

function addPage(ctx: ReportContext, first = false, reuseCurrent = false) {
  if (reuseCurrent) {
    ctx.pageNumber = 1;
  } else {
    ctx.page = ctx.doc.addPage([WIDTH, HEIGHT]);
    ctx.pageNumber += 1;
  }
  drawTopBar(ctx.page, first ? 9 : 5);

  if (first) {
    ctx.page.drawCircle({
      x: MARGIN + 14,
      y: HEIGHT - 64,
      size: 15,
      color: ORANGE,
    });
    ctx.page.drawText("S", {
      x: MARGIN + 9.5,
      y: HEIGHT - 69,
      size: 17,
      font: ctx.bold,
      color: WHITE,
    });
    ctx.page.drawText("SAVORA", {
      x: MARGIN + 36,
      y: HEIGHT - 62,
      size: 20,
      font: ctx.bold,
      color: DARK,
    });
    drawRightText(
      ctx,
      "RAPPORT HEBDOMADAIRE",
      WIDTH - MARGIN,
      HEIGHT - 59,
      9,
      ctx.bold,
      ORANGE,
    );

    ctx.page.drawText(
      fitText(ctx.data.restaurant.name, ctx.bold, 17, CONTENT_WIDTH),
      { x: MARGIN, y: HEIGHT - 105, size: 17, font: ctx.bold, color: DARK },
    );
    ctx.page.drawText(clean(formatWeekLabel(ctx.data.period)), {
      x: MARGIN,
      y: HEIGHT - 123,
      size: 9.5,
      font: ctx.regular,
      color: MUTED,
    });
    drawRightText(
      ctx,
      `Généré le ${formatDateTimeFr(ctx.data.generatedAt)}`,
      WIDTH - MARGIN,
      HEIGHT - 123,
      8,
      ctx.regular,
      MUTED,
    );

    ctx.page.drawLine({
      start: { x: MARGIN, y: HEIGHT - 140 },
      end: { x: WIDTH - MARGIN, y: HEIGHT - 140 },
      thickness: 1,
      color: LINE,
    });
    ctx.y = HEIGHT - 160;
    return;
  }

  ctx.page.drawText("SAVORA", {
    x: MARGIN,
    y: HEIGHT - 29,
    size: 10,
    font: ctx.bold,
    color: DARK,
  });
  drawRightText(
    ctx,
    `Rapport hebdomadaire - ${ctx.data.restaurant.name}`,
    WIDTH - MARGIN,
    HEIGHT - 29,
    8,
    ctx.regular,
    MUTED,
  );
  ctx.page.drawLine({
    start: { x: MARGIN, y: HEIGHT - 39 },
    end: { x: WIDTH - MARGIN, y: HEIGHT - 39 },
    thickness: 0.7,
    color: LINE,
  });
  ctx.y = HEIGHT - 55;
}

function ensureSpace(ctx: ReportContext, height: number) {
  if (ctx.y - height < 52) addPage(ctx);
}

function drawSectionTitle(ctx: ReportContext, title: string, subtitle?: string) {
  ensureSpace(ctx, subtitle ? 40 : 28);
  ctx.page.drawRectangle({
    x: MARGIN,
    y: ctx.y - 10,
    width: 3,
    height: 13,
    color: ORANGE,
  });
  drawText(ctx, title, MARGIN + 10, ctx.y - 9, 11.5, ctx.bold, DARK);
  ctx.y -= 17;

  if (subtitle) {
    drawText(ctx, subtitle, MARGIN, ctx.y - 8, 7.8, ctx.regular, MUTED, CONTENT_WIDTH);
    ctx.y -= 16;
  }

  ctx.page.drawLine({
    start: { x: MARGIN, y: ctx.y - 4 },
    end: { x: WIDTH - MARGIN, y: ctx.y - 4 },
    thickness: 0.6,
    color: LINE,
  });
  ctx.y -= 14;
}

function drawNote(ctx: ReportContext, text: string) {
  ensureSpace(ctx, 22);
  ctx.page.drawRectangle({
    x: MARGIN,
    y: ctx.y - 17,
    width: CONTENT_WIDTH,
    height: 20,
    color: SOFT_BG,
  });
  drawText(ctx, text, MARGIN + 7, ctx.y - 12, 7.5, ctx.regular, MUTED, CONTENT_WIDTH - 14);
  ctx.y -= 27;
}

function drawMetricCards(ctx: ReportContext) {
  const data = ctx.data;
  const gap = 8;
  const cardWidth = (CONTENT_WIDTH - gap * 3) / 4;
  const cardHeight = 55;
  ensureSpace(ctx, cardHeight + 12);

  const cards = [
    {
      label: "Chiffre d'affaires",
      value: formatMoney(data.orders.revenue, data.restaurant.currency),
      color: DARK,
    },
    {
      label: "Commandes",
      value: String(data.orders.total),
      color: DARK,
    },
    {
      label: "Panier moyen",
      value: formatMoney(data.orders.average, data.restaurant.currency),
      color: ORANGE,
    },
    {
      label: "Payées en ligne",
      value: String(data.orders.paid),
      color: GREEN,
    },
  ];

  cards.forEach((card, index) => {
    const x = MARGIN + index * (cardWidth + gap);
    ctx.page.drawRectangle({
      x,
      y: ctx.y - cardHeight,
      width: cardWidth,
      height: cardHeight,
      color: index === 0 ? ORANGE_SOFT : WHITE,
      borderColor: index === 0 ? ORANGE : LINE,
      borderWidth: index === 0 ? 1 : 0.6,
    });
    drawText(ctx, card.label, x + 9, ctx.y - 17, 7.2, ctx.regular, MUTED, cardWidth - 18);
    drawText(
      ctx,
      card.value,
      x + 9,
      ctx.y - 38,
      12.5,
      ctx.bold,
      card.color,
      cardWidth - 18,
    );
  });

  ctx.y -= cardHeight + 16;
}

function drawTable(
  ctx: ReportContext,
  columns: TableColumn[],
  rows: TableRow[],
) {
  const headerHeight = 20;
  const rowHeight = 20;
  const tableWidth = columns.reduce((sum, column) => sum + column.width, 0);
  const scale = tableWidth > CONTENT_WIDTH ? CONTENT_WIDTH / tableWidth : 1;
  const widths = columns.map((column) => column.width * scale);

  const drawHeader = () => {
    ensureSpace(ctx, headerHeight + rowHeight);
    let x = MARGIN;
    ctx.page.drawRectangle({
      x: MARGIN,
      y: ctx.y - headerHeight,
      width: CONTENT_WIDTH,
      height: headerHeight,
      color: DARK,
    });
    columns.forEach((column, index) => {
      const width = widths[index];
      const text = fitText(column.header, ctx.bold, 7.6, width - 10);
      const textWidth = ctx.bold.widthOfTextAtSize(text, 7.6);
      let textX = x + 5;
      if (column.align === "right") textX = x + width - textWidth - 5;
      if (column.align === "center") textX = x + (width - textWidth) / 2;
      ctx.page.drawText(text, {
        x: textX,
        y: ctx.y - 13.5,
        size: 7.6,
        font: ctx.bold,
        color: WHITE,
      });
      x += width;
    });
    ctx.y -= headerHeight;
  };

  drawHeader();

  rows.forEach((row, rowIndex) => {
    if (ctx.y - rowHeight < 52) {
      addPage(ctx);
      drawHeader();
    }

    if (rowIndex % 2 === 1) {
      ctx.page.drawRectangle({
        x: MARGIN,
        y: ctx.y - rowHeight,
        width: CONTENT_WIDTH,
        height: rowHeight,
        color: SOFT_BG,
      });
    }

    let x = MARGIN;
    columns.forEach((column, columnIndex) => {
      const width = widths[columnIndex];
      const value = row[columnIndex] ?? "";
      const text = fitText(value, ctx.regular, 8, width - 10);
      const textWidth = ctx.regular.widthOfTextAtSize(text, 8);
      let textX = x + 5;
      if (column.align === "right") textX = x + width - textWidth - 5;
      if (column.align === "center") textX = x + (width - textWidth) / 2;
      ctx.page.drawText(text, {
        x: textX,
        y: ctx.y - 13.5,
        size: 8,
        font: ctx.regular,
        color: DARK,
      });
      x += width;
    });

    ctx.page.drawLine({
      start: { x: MARGIN, y: ctx.y - rowHeight },
      end: { x: WIDTH - MARGIN, y: ctx.y - rowHeight },
      thickness: 0.4,
      color: LINE,
    });
    ctx.y -= rowHeight;
  });

  ctx.y -= 14;
}

function drawOrdersSection(ctx: ReportContext) {
  drawSectionTitle(
    ctx,
    "Commandes de la semaine",
    "Le chiffre d'affaires exclut les commandes annulées. Le panier moyen porte sur les commandes non annulées.",
  );

  const rows = ctx.data.orders.byStatus.map((item) => [
    item.label,
    String(item.count),
  ]);
  rows.push(["Total", String(ctx.data.orders.total)]);

  drawTable(
    ctx,
    [
      { header: "Statut", width: 360 },
      { header: "Nombre", width: 140, align: "right" },
    ],
    rows,
  );

  const paymentRows = [
    ["Commandes payées (paiement en ligne validé)", String(ctx.data.orders.paid)],
    ["En attente de paiement en ligne", String(ctx.data.orders.awaitingPayment)],
    ["Sans paiement en ligne enregistré", String(ctx.data.orders.withoutOnlinePayment)],
    ["Commandes annulées", String(ctx.data.orders.cancelled)],
    ["Commandes remboursées", String(ctx.data.orders.refunded)],
  ];

  drawTable(
    ctx,
    [
      { header: "Suivi des paiements", width: 400 },
      { header: "Nombre", width: 100, align: "right" },
    ],
    paymentRows,
  );
}

function drawPaymentsSection(ctx: ReportContext) {
  drawSectionTitle(ctx, "Paiements et remboursements");

  if (ctx.data.payments.totalCount === 0) {
    drawNote(
      ctx,
      "Aucun paiement en ligne enregistré sur cette période. Les commandes réglées hors ligne ne sont pas comptabilisées ici.",
    );
  } else {
    const rows = ctx.data.payments.byStatus.map((item) => [
      item.label,
      String(item.count),
      formatMoney(item.amount, ctx.data.restaurant.currency),
    ]);
    rows.push([
      "Total",
      String(ctx.data.payments.totalCount),
      formatMoney(
        ctx.data.payments.paidAmount +
          ctx.data.payments.pendingAmount +
          ctx.data.payments.failedAmount +
          ctx.data.payments.refundedAmount,
        ctx.data.restaurant.currency,
      ),
    ]);

    drawTable(
      ctx,
      [
        { header: "Statut du paiement", width: 260 },
        { header: "Nombre", width: 90, align: "right" },
        { header: "Montant", width: 150, align: "right" },
      ],
      rows,
    );

    if (ctx.data.payments.methods.length > 0) {
      drawTable(
        ctx,
        [
          { header: "Moyen de paiement", width: 260 },
          { header: "Paiements validés", width: 90, align: "right" },
          { header: "Montant encaissé", width: 150, align: "right" },
        ],
        ctx.data.payments.methods.map((method) => [
          method.label,
          String(method.count),
          formatMoney(method.amount, ctx.data.restaurant.currency),
        ]),
      );
    }
  }

  drawNote(
    ctx,
    ctx.data.refunds.supported
      ? `Remboursements : ${ctx.data.refunds.count} pour ${formatMoney(
          ctx.data.refunds.amount,
          ctx.data.restaurant.currency,
        )}.`
      : "Remboursements : 0. Le schéma de paiement actuel ne comporte pas encore de statut « remboursé ».",
  );
}

function drawDailySection(ctx: ReportContext) {
  drawSectionTitle(ctx, "Détail quotidien des ventes");

  const rows = ctx.data.daily.map((day) => [
    formatDateFr(day.date),
    String(day.orders),
    formatMoney(day.revenue, ctx.data.restaurant.currency),
  ]);
  const totalOrders = ctx.data.daily.reduce((sum, day) => sum + day.orders, 0);
  const totalRevenue = ctx.data.daily.reduce((sum, day) => sum + day.revenue, 0);
  rows.push([
    "Total",
    String(totalOrders),
    formatMoney(totalRevenue, ctx.data.restaurant.currency),
  ]);

  drawTable(
    ctx,
    [
      { header: "Jour", width: 150 },
      { header: "Commandes", width: 120, align: "right" },
      { header: "Chiffre d'affaires", width: 230, align: "right" },
    ],
    rows,
  );
}

function drawTopDishesSection(ctx: ReportContext) {
  drawSectionTitle(
    ctx,
    "Plats les plus vendus",
    "Quantités et chiffre d'affaires hors commandes annulées.",
  );

  if (ctx.data.topDishes.length === 0) {
    drawNote(ctx, "Aucun plat vendu sur cette période.");
    return;
  }

  drawTable(
    ctx,
    [
      { header: "#", width: 35, align: "center" },
      { header: "Plat", width: 285 },
      { header: "Quantité", width: 80, align: "right" },
      { header: "Chiffre d'affaires", width: 150, align: "right" },
    ],
    ctx.data.topDishes.map((dish, index) => [
      String(index + 1),
      dish.name,
      String(dish.quantity),
      formatMoney(dish.revenue, ctx.data.restaurant.currency),
    ]),
  );
}

function drawFooters(ctx: ReportContext) {
  const pages = ctx.doc.getPages();
  pages.forEach((page, index) => {
    page.drawLine({
      start: { x: MARGIN, y: 39 },
      end: { x: WIDTH - MARGIN, y: 39 },
      thickness: 0.5,
      color: LINE,
    });
    page.drawText(
      clean(`Généré le ${formatDateTimeFr(ctx.data.generatedAt)} par Savora`),
      { x: MARGIN, y: 26, size: 7, font: ctx.regular, color: MUTED },
    );
    const pageLabel = `Page ${index + 1} / ${pages.length}`;
    page.drawText(pageLabel, {
      x: WIDTH - MARGIN - ctx.regular.widthOfTextAtSize(pageLabel, 7),
      y: 26,
      size: 7,
      font: ctx.regular,
      color: MUTED,
    });
  });
}

export async function buildWeeklyReportPdf(
  data: WeeklyReportData,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  doc.setTitle(
    clean(
      `Savora - Rapport hebdomadaire - ${data.restaurant.name} - ${formatWeekLabel(
        data.period,
      )}`,
    ),
  );
  doc.setAuthor("Savora");
  doc.setSubject("Rapport hebdomadaire des ventes");
  doc.setProducer("Savora");
  doc.setCreationDate(new Date(data.generatedAt));

  const ctx: ReportContext = {
    doc,
    data,
    regular,
    bold,
    page: doc.addPage([WIDTH, HEIGHT]),
    pageNumber: 0,
    y: 0,
  };

  // Réutilise la page créée ci-dessus pour l'en-tête de couverture.
  addPage(ctx, true, true);

  drawMetricCards(ctx);
  drawOrdersSection(ctx);
  drawPaymentsSection(ctx);
  drawDailySection(ctx);
  drawTopDishesSection(ctx);
  drawFooters(ctx);

  return doc.save();
}
