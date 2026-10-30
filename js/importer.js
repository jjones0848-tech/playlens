// importer.js — turns uploaded files and photos into draft plays.
// Supported: images (JPG, PNG, WebP, GIF, HEIC on Safari), PDF, PowerPoint (.pptx), Word (.docx), PlayLens JSON.
// The PDF and ZIP libraries load from a CDN only when needed, so the app itself stays small.

import { playersFromFormation, uid } from './data.js';

const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const JSZIP = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
const MAX_SIDE = 1600;

const loaded = {};
function loadScript(src) {
  loaded[src] ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Couldn’t load a helper library. Check your internet connection and try again.'));
    document.head.appendChild(s);
  });
  return loaded[src];
}

// Draw an image onto a canvas, shrink it, and boost contrast so pencil and marker lines stand out.
function toEnhancedDataUrl(source, w, h) {
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if ('filter' in ctx) ctx.filter = 'contrast(1.25) brightness(1.05)';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85);
}

async function blobToDataUrl(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return toEnhancedDataUrl(img, img.naturalWidth, img.naturalHeight);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function pdfPages(file) {
  await loadScript(PDFJS);
  const pdfjsLib = window.pdfjsLib;
  pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const doc = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 1400 / base.width });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    pages.push({ name: `Page ${i}`, image: toEnhancedDataUrl(canvas, canvas.width, canvas.height) });
  }
  return pages;
}

const IMG_EXT = /\.(png|jpe?g|gif|webp)$/i;
const byNumber = (a, b) => (parseInt(a.match(/(\d+)\D*$/)?.[1] || 0, 10)) - (parseInt(b.match(/(\d+)\D*$/)?.[1] || 0, 10));

async function pptxPages(file, errors) {
  await loadScript(JSZIP);
  const zip = await window.JSZip.loadAsync(file);
  const slides = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort(byNumber);
  const pages = [];
  for (const slide of slides) {
    const num = slide.match(/slide(\d+)/)[1];
    const rels = zip.file(`ppt/slides/_rels/slide${num}.xml.rels`);
    const xml = rels ? await rels.async('string') : '';
    const targets = [...xml.matchAll(/Type="[^"]*\/image"[^>]*Target="([^"]+)"|Target="([^"]+)"[^>]*Type="[^"]*\/image"/g)]
      .map((m) => (m[1] || m[2]).replace(/^\.\.\//, 'ppt/'))
      .filter((t) => IMG_EXT.test(t));
    if (!targets.length) {
      errors.push(`Slide ${num} has no picture to read. Plays drawn with PowerPoint shapes can’t be read yet — save the deck as a PDF and import that instead.`);
      continue;
    }
    const blob = await zip.file(targets[0]).async('blob');
    pages.push({ name: `Slide ${num}`, image: await blobToDataUrl(blob) });
  }
  return pages;
}

async function docxPages(file, errors) {
  await loadScript(JSZIP);
  const zip = await window.JSZip.loadAsync(file);
  const media = Object.keys(zip.files).filter((n) => n.startsWith('word/media/') && IMG_EXT.test(n)).sort(byNumber);
  if (!media.length) errors.push(`${file.name} has no pictures of plays. Save it as a PDF and import that instead.`);
  const pages = [];
  for (const [i, m] of media.entries()) {
    pages.push({ name: `Picture ${i + 1}`, image: await blobToDataUrl(await zip.file(m).async('blob')) });
  }
  return pages;
}

// Returns { pages: [{name, image}], plays: [play objects from JSON], errors: [text] }
export async function importFiles(files, onProgress = () => {}) {
  const out = { pages: [], plays: [], errors: [] };
  for (const file of files) {
    const base = file.name.replace(/\.[^.]+$/, '');
    onProgress(`Reading ${file.name}…`);
    try {
      const n = file.name.toLowerCase();
      if (n.endsWith('.json')) {
        const data = JSON.parse(await file.text());
        const plays = Array.isArray(data) ? data : data.plays;
        if (!Array.isArray(plays)) throw new Error(`${file.name} isn’t a PlayLens playbook file.`);
        out.plays.push(...plays.map((p) => ({ ...p, id: uid() })));
      } else if (n.endsWith('.pdf')) {
        (await pdfPages(file)).forEach((p) => out.pages.push({ ...p, name: `${base} — ${p.name}` }));
      } else if (n.endsWith('.pptx')) {
        (await pptxPages(file, out.errors)).forEach((p) => out.pages.push({ ...p, name: `${base} — ${p.name}` }));
      } else if (n.endsWith('.docx')) {
        (await docxPages(file, out.errors)).forEach((p) => out.pages.push({ ...p, name: `${base} — ${p.name}` }));
      } else if (file.type.startsWith('image/') || /\.(heic|heif)$/.test(n)) {
        out.pages.push({ name: base, image: await blobToDataUrl(file) });
      } else {
        out.errors.push(`${file.name}: this file type can’t be read. Save it as a PDF or a picture and try again.`);
      }
    } catch (err) {
      const heic = /\.(heic|heif)$/i.test(file.name);
      out.errors.push(heic
        ? `${file.name}: this browser can’t open HEIC photos. Take the photo from inside PlayLens, or change your camera setting to JPG.`
        : `${file.name}: ${err.message || 'couldn’t be read.'}`);
    }
  }
  return out;
}

// A new draft play waiting for the coach to review.
export function draftFromPage(page, number) {
  return {
    id: uid(),
    number,
    name: page.name,
    category: 'Runs',
    formation: 'I-form',
    type: 'run',
    snap: '',
    goal: '',
    duration: 4,
    front: '4-4',
    status: 'draft',
    sourceImage: page.image,
    ball: [{ t: 0, hold: 'QB' }],
    players: playersFromFormation('I-form')
  };
}
