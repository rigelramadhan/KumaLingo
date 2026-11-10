import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

const compare = (a, b) => a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const string = (value) => typeof value === 'string' ? value : '';

// Export only notebook schema fields, never session/config/provider objects.
export function notebookForExport(input) {
  const folders = input.folders.map((folder) => ({ id: string(folder.id), title: string(folder.title), parentId: folder.parentId ?? null, depth: Number(folder.depth), ancestorIds: Array.isArray(folder.ancestorIds) ? folder.ancestorIds.map(string) : [], sortKey: string(folder.sortKey), status: string(folder.status), revision: Number(folder.revision ?? 0) }));
  const active = new Set(folders.filter((folder) => folder.status === 'active' && folder.ancestorIds.every((id) => folders.some((parent) => parent.id === id && parent.status === 'active'))).map((folder) => folder.id));
  const notes = input.notes.filter((note) => active.has(note.folderId)).map((note) => ({ id: string(note.id), folderId: string(note.folderId), hanzi: string(note.hanzi), pinyin: string(note.pinyin), translation: string(note.translation), rawPinyin: string(note.rawPinyin), aiTranslation: string(note.aiTranslation), sortKey: string(note.sortKey), ancestorIds: Array.isArray(note.ancestorIds) ? note.ancestorIds.map(string) : [], revision: Number(note.revision ?? 0) }));
  return { folders: folders.filter((folder) => active.has(folder.id)), notes };
}
export function orderedSections(input) {
  const notebook = notebookForExport(input);
  const visited = new Set();
  const sections = [];
  function walk(parentId, titles) {
    for (const folder of notebook.folders.filter((folder) => folder.parentId === parentId).sort(compare)) {
      if (visited.has(folder.id) || titles.length >= 3 || folder.depth !== titles.length + 1) throw new Error('Notebook hierarchy is invalid.');
      visited.add(folder.id);
      const breadcrumb = [...titles, folder.title];
      sections.push({ folder, breadcrumb: breadcrumb.join(' / '), notes: notebook.notes.filter((note) => note.folderId === folder.id).sort(compare) });
      walk(folder.id, breadcrumb);
    }
  }
  walk(null, []);
  if (visited.size !== notebook.folders.length) throw new Error('Notebook hierarchy is incomplete.');
  return sections;
}
function download(bytes, type, filename) {
  const blob = new Blob([bytes], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function downloadNotebookBackup(notebook) {
  orderedSections(notebook);
  download(JSON.stringify({ format: 'kumalingo', version: 1, notebook: notebookForExport(notebook) }, null, 2), 'application/json', 'kumalingo-backup.json');
}

export async function createNotebookPdf(notebook, fontBytes) {
  const sections = orderedSections(notebook);
  const pdf = await PDFDocument.create();
  pdf.setTitle('KumaLingo — Mandarin notebook'); pdf.setCreator('KumaLingo');
  pdf.registerFontkit(fontkit);
  // Full embedding avoids incorrect CJK glyph remapping in fontkit's subsetter.
  const font = await pdf.embedFont(fontBytes, { subset: false });
  const supported = new Set(font.getCharacterSet());
  for (const section of sections) for (const content of [section.breadcrumb, ...section.notes.flatMap((note) => [note.hanzi, note.pinyin, note.translation])]) {
    if ([...content].some((character) => !['\n', '\r', '\t'].includes(character) && !supported.has(character.codePointAt(0)))) throw new Error('The export font does not support every character in this notebook.');
  }
  const size = [595.28, 841.89];
  const ink = rgb(0.2, 0.18, 0.17), muted = rgb(0.45, 0.42, 0.4), coral = rgb(0.83, 0.35, 0.31);
  let page;
  let y;
  let currentSection = '';
  const widths = new Map();
  function width(character, fontSize) {
    const key = `${fontSize}:${character}`;
    if (!widths.has(key)) widths.set(key, font.widthOfTextAtSize(character, fontSize));
    return widths.get(key);
  }
  function wrap(content, fontSize, maxWidth) {
    const lines = [];
    for (const paragraph of content.replaceAll('\r', '').replaceAll('\t', '    ').split('\n')) {
      let line = '', used = 0;
      for (const character of paragraph) {
        const next = width(character, fontSize);
        if (line && used + next > maxWidth) {
          const space = line.lastIndexOf(' ');
          if (space > line.length / 2) { lines.push(line.slice(0, space)); line = line.slice(space + 1); used = [...line].reduce((sum, char) => sum + width(char, fontSize), 0); }
          else { lines.push(line); line = ''; used = 0; }
        }
        line += character; used += next;
      }
      lines.push(line);
    }
    return lines;
  }
  function nextPage(repeat = true) {
    page = pdf.addPage(size); y = size[1] - 48;
    page.drawText('KumaLingo', { x: 44, y, font, size: 11, color: coral }); y -= 30;
    if (repeat && currentSection) for (const line of wrap(currentSection, 10, size[0] - 88)) { page.drawText(line, { x: 44, y, font, size: 10, color: muted }); y -= 15; }
    if (repeat && currentSection) y -= 12;
  }
  function draw(lines, fontSize, x, color) {
    for (const line of lines) {
      if (y < 60) nextPage();
      if (line) page.drawText(line, { x, y, font, size: fontSize, color });
      y -= fontSize * 1.5;
    }
  }
  nextPage(false);
  draw(['My Mandarin notebook'], 23, 44, ink); y -= 16;
  for (const section of sections) {
    const indent = (section.folder.depth - 1) * 16;
    if (y < 150) nextPage(false);
    currentSection = section.breadcrumb;
    draw(wrap(section.folder.title, 19 - section.folder.depth, size[0] - 88 - indent), 19 - section.folder.depth, 44 + indent, coral); y -= 8;
    for (const note of section.notes) {
      const lines = [wrap(note.hanzi, 17, size[0] - 104 - indent), wrap(note.pinyin, 11, size[0] - 104 - indent), wrap(note.translation, 11, size[0] - 104 - indent)];
      const height = lines[0].length * 25.5 + (lines[1].length + lines[2].length) * 16.5 + 16;
      if (height < 640 && height > y - 60) nextPage();
      draw(lines[0], 17, 52 + indent, ink);
      draw(lines[1], 11, 52 + indent, coral);
      draw(lines[2], 11, 52 + indent, ink); y -= 16;
    }
    y -= 10;
  }
  for (const [index, item] of pdf.getPages().entries()) item.drawText(`${index + 1} / ${pdf.getPageCount()}`, { x: 44, y: 26, font, size: 9, color: muted });
  return pdf.save();
}
export async function downloadNotebookPdf(notebook, isCurrent = () => true) {
  const response = await fetch('/composeResources/com.kumalingo.resources/font/kumalingo_sc_regular.ttf');
  if (!response.ok) throw new Error('The PDF font could not be loaded.');
  const bytes = await createNotebookPdf(notebook, new Uint8Array(await response.arrayBuffer()));
  if (!isCurrent()) return;
  download(bytes, 'application/pdf', 'kumalingo-notebook.pdf');
}
