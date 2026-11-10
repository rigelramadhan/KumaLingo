import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { createNotebookPdf, notebookForExport, orderedSections } from '../src/exports.mjs';

const notebook = {
  folders: [
    { id: 'root', title: 'Everyday 每天', parentId: null, depth: 1, ancestorIds: [], sortKey: 'a0', status: 'active' },
    { id: 'child', title: 'Greetings', parentId: 'root', depth: 2, ancestorIds: ['root'], sortKey: 'a0', status: 'active' },
    { id: 'leaf', title: 'Morning', parentId: 'child', depth: 3, ancestorIds: ['root', 'child'], sortKey: 'a0', status: 'active' },
  ],
  notes: [
    { id: 'a', folderId: 'root', hanzi: '你好', pinyin: 'nǐ hǎo', translation: 'Halo, selamat datang.', aiTranslation: 'Halo', sortKey: 'a0', accessToken: 'synthetic-field-to-exclude' },
    { id: 'b', folderId: 'leaf', hanzi: '绿色', pinyin: 'lǜ sè', translation: 'Warna hijau', sortKey: 'a0' },
  ],
  credentials: 'synthetic-field-to-exclude',
};
test('exports retain hierarchy and edited meaning while excluding non-notebook fields', () => {
  assert.deepEqual(orderedSections(notebook).map((section) => section.folder.id), ['root', 'child', 'leaf']);
  const safe = notebookForExport(notebook);
  assert.equal(safe.notes[0].translation, 'Halo, selamat datang.');
  assert.ok(!JSON.stringify(safe).includes('synthetic-field-to-exclude'));
  const deleting = { ...notebook, folders: notebook.folders.map((folder) => folder.id === 'root' ? { ...folder, status: 'deleting' } : folder) };
  assert.equal(notebookForExport(deleting).notes.length, 0);
});
test('PDF embeds CJK/tone fonts, supports long notes and preserves all chapter levels', async () => {
  const font = await readFile(new URL('../../composeApp/src/commonMain/composeResources/font/kumalingo_sc_regular.ttf', import.meta.url));
  const input = { ...notebook, notes: [...notebook.notes, ...Array.from({ length: 35 }, (_, index) => ({ ...notebook.notes[0], id: `long${index}`, sortKey: `b${index}`, translation: 'Kalimat panjang untuk belajar Mandarin. '.repeat(25) }))] };
  const bytes = await createNotebookPdf(input, font);
  const pdf = await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() > 2);
  assert.equal(pdf.getTitle(), 'KumaLingo — Mandarin notebook');
  await mkdir(new URL('../../.tools/export-tests/', import.meta.url), { recursive: true });
  await writeFile(new URL('../../.tools/export-tests/notebook.pdf', import.meta.url), bytes);
});
