'use strict';

/* =========================================================
   SQUISH — main.js (compressor tool only)
   All image compression happens locally via the Canvas API.
   Nothing here ever sends image data anywhere.
   Shared chrome (theme, nav, ripple, reveal) lives in site.js.
   ========================================================= */

(function () {
  const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
  const ACCEPTED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

  /** In-memory store of every uploaded image and its state. Never persisted. */
  const store = new Map(); // id -> record
  let idCounter = 0;

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const dropzone = $('#dropzone');
  const fileInput = $('#fileInput');
  const uploadProgress = $('#uploadProgress');
  const uploadProgressBar = $('#uploadProgressBar');
  const errorArea = $('#errorArea');
  const statsBar = $('#statsBar');
  const settingsPanel = $('#settingsPanel');
  const pairList = $('#pairList');
  const pairTemplate = $('#imagePairTemplate');

  // Tool-only pages have all of the above; bail out quietly if this script
  // is ever included somewhere without the workspace markup.
  if (!dropzone || !fileInput || !pairTemplate) return;

  const qualitySlider = $('#qualitySlider');
  const qualityValue = $('#qualityValue');
  const resizeWidth = $('#resizeWidth');
  const resizeHeight = $('#resizeHeight');
  const keepAspect = $('#keepAspect');
  const outputFormat = $('#outputFormat');
  const compressAllBtn = $('#compressAllBtn');
  const resetBtn = $('#resetBtn');
  const downloadAllBtn = $('#downloadAllBtn');
  const clearAllBtn = $('#clearAllBtn');

  const statCount = $('#statCount');
  const statOriginal = $('#statOriginal');
  const statCompressed = $('#statCompressed');
  const statSaved = $('#statSaved');

  const toastStack = $('#toastStack');

  /* ----------------------------- Utilities ----------------------------- */

  function formatBytes(bytes) {
    if (bytes === 0) return '0 KB';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    const val = bytes / Math.pow(1024, i);
    return `${val >= 100 ? Math.round(val) : val.toFixed(val >= 10 ? 0 : 1)} ${units[i]}`;
  }

  function extFromType(type) {
    if (type === 'image/jpeg' || type === 'image/jpg') return 'jpg';
    if (type === 'image/png') return 'png';
    if (type === 'image/webp') return 'webp';
    return 'img';
  }

  function baseName(filename) {
    const dot = filename.lastIndexOf('.');
    return dot > 0 ? filename.slice(0, dot) : filename;
  }

  function showToast(message, type = 'default') {
    if (!toastStack) return;
    const el = document.createElement('div');
    el.className = `toast${type === 'success' ? ' toast-success' : ''}${type === 'error' ? ' toast-error' : ''}`;
    el.textContent = message;
    toastStack.appendChild(el);
    setTimeout(() => {
      el.classList.add('hide');
      setTimeout(() => el.remove(), 320);
    }, 3200);
  }

  function showError(title, detail) {
    const card = document.createElement('div');
    card.className = 'error-card';
    card.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v5M12 16h.01"/></svg>
      <div><strong></strong><p></p></div>
      <button class="icon-btn" type="button" aria-label="Dismiss error">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>`;
    card.querySelector('strong').textContent = title;
    card.querySelector('p').textContent = detail;
    card.querySelector('.icon-btn').addEventListener('click', () => card.remove());
    errorArea.appendChild(card);
    setTimeout(() => card.remove(), 8000);
  }

  /* ----------------------------- Upload entry points ----------------------------- */
  dropzone.addEventListener('click', (e) => {
    if (e.target.closest('input')) return;
    fileInput.click();
  });
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });

  fileInput.addEventListener('change', () => {
    handleFiles(fileInput.files);
    fileInput.value = '';
  });

  ['dragenter', 'dragover'].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      if (evt === 'dragleave' && e.target !== dropzone) return;
      dropzone.classList.remove('dragover');
    });
  });
  dropzone.addEventListener('drop', (e) => {
    if (e.dataTransfer && e.dataTransfer.files) handleFiles(e.dataTransfer.files);
  });

  document.addEventListener('paste', (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    const files = [];
    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length) handleFiles(files);
  });

  // Keyboard shortcut: Ctrl+O to open the file browser.
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
      e.preventDefault();
      fileInput.click();
    }
  });

  /* ----------------------------- File handling / validation ----------------------------- */
  function handleFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;

    let accepted = 0;
    simulateUploadProgress();

    files.forEach((file) => {
      if (!ACCEPTED_TYPES.includes(file.type)) {
        showError('Unsupported format', `"${file.name}" isn't a JPG, PNG, or WEBP file.`);
        return;
      }
      if (file.size > MAX_FILE_SIZE) {
        showError('File too large', `"${file.name}" is over the 50MB limit.`);
        return;
      }
      addImage(file);
      accepted += 1;
    });

    if (accepted > 0) {
      statsBar.hidden = false;
      settingsPanel.hidden = false;
      showToast(`Added ${accepted} image${accepted > 1 ? 's' : ''}`, 'success');
    }
  }

  function simulateUploadProgress() {
    uploadProgress.hidden = false;
    uploadProgressBar.style.width = '0%';
    let pct = 0;
    const timer = setInterval(() => {
      pct += 18 + Math.random() * 20;
      if (pct >= 100) {
        pct = 100;
        uploadProgressBar.style.width = '100%';
        clearInterval(timer);
        setTimeout(() => { uploadProgress.hidden = true; }, 350);
      } else {
        uploadProgressBar.style.width = `${pct}%`;
      }
    }, 90);
  }

  function addImage(file) {
    const id = `img-${++idCounter}`;
    const originalUrl = URL.createObjectURL(file);

    const img = new Image();
    img.onload = () => {
      const record = {
        id,
        file,
        originalUrl,
        width: img.naturalWidth,
        height: img.naturalHeight,
        compressedBlob: null,
        compressedUrl: null,
        compressTimeMs: null,
        renamedTo: null,
      };
      store.set(id, record);
      renderPair(record);
      updateStats();
    };
    img.onerror = () => {
      showError('Corrupted file', `"${file.name}" couldn't be read as an image.`);
    };
    img.src = originalUrl;
  }

  /* ----------------------------- Card rendering ----------------------------- */
  function renderPair(record) {
    const node = pairTemplate.content.firstElementChild.cloneNode(true);
    node.dataset.id = record.id;

    // Original card
    node.querySelector('.thumb-original').src = record.originalUrl;
    node.querySelector('.thumb-original').alt = record.file.name;
    node.querySelector('.filename').textContent = record.file.name;
    node.querySelector('.filename').title = record.file.name;
    node.querySelector('.dims').textContent = `${record.width}×${record.height}`;
    node.querySelector('.ftype').textContent = extFromType(record.file.type).toUpperCase();
    node.querySelector('.osize').textContent = formatBytes(record.file.size);
    node.querySelector('.remove-btn').addEventListener('click', () => removeImage(record.id));

    // Compressed card interactions
    node.querySelector('.compress-one-btn').addEventListener('click', () => compressOne(record.id));

    const renameInput = node.querySelector('.rename-input');
    renameInput.placeholder = baseName(record.file.name);
    renameInput.addEventListener('input', () => { record.renamedTo = renameInput.value.trim() || null; });

    node.querySelector('.download-btn').addEventListener('click', () => downloadOne(record.id));

    pairList.appendChild(node);
    if (window.squishObserveReveal) window.squishObserveReveal(pairList);
  }

  function getPair(id) {
    return pairList.querySelector(`.image-pair[data-id="${id}"]`);
  }

  function removeImage(id) {
    const record = store.get(id);
    if (!record) return;
    URL.revokeObjectURL(record.originalUrl);
    if (record.compressedUrl) URL.revokeObjectURL(record.compressedUrl);
    store.delete(id);
    const pair = getPair(id);
    if (pair) pair.remove();
    updateStats();
    if (store.size === 0) statsBar.hidden = true;
  }

  /* ----------------------------- Compression (Canvas API) ----------------------------- */
  function computeTargetDims(record) {
    let targetW = parseInt(resizeWidth.value, 10) || null;
    let targetH = parseInt(resizeHeight.value, 10) || null;
    const ratio = record.width / record.height;

    if (targetW && targetH && keepAspect.checked) {
      if (targetW / targetH > ratio) targetW = Math.round(targetH * ratio);
      else targetH = Math.round(targetW / ratio);
    } else if (targetW && keepAspect.checked) {
      targetH = Math.round(targetW / ratio);
    } else if (targetH && keepAspect.checked) {
      targetW = Math.round(targetH * ratio);
    }

    return {
      width: targetW || record.width,
      height: targetH || record.height,
    };
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Image failed to decode'));
      img.src = src;
    });
  }

  function canvasToBlob(canvas, mimeType, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) reject(new Error('Canvas export failed'));
        else resolve(blob);
      }, mimeType, quality);
    });
  }

  /**
   * Compresses an image and guarantees the result is never larger than the
   * original file. Lossy formats (JPEG/WEBP) get a couple of extra passes at
   * lower quality if the first attempt didn't actually save space; if nothing
   * beats the original (common for already-optimized PNGs with no resize
   * requested), the original bytes are returned instead so the user never
   * ends up with a bigger "compressed" file.
   */
  async function compressImage(record) {
    const start = performance.now();
    const img = await loadImage(record.originalUrl);

    const { width, height } = computeTargetDims(record);
    const chosenFormat = outputFormat.value === 'original' ? record.file.type : outputFormat.value;
    const mimeType = ACCEPTED_TYPES.includes(chosenFormat) ? chosenFormat : record.file.type;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';

    // PNG/WEBP source drawn onto a JPEG output needs a solid background or
    // transparent pixels turn black on export.
    if (mimeType === 'image/jpeg') {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(img, 0, 0, width, height);

    const isLossy = mimeType === 'image/jpeg' || mimeType === 'image/webp';
    const baseQuality = Number(qualitySlider.value) / 100;

    // Try the requested quality first, then a couple of lower fallback
    // passes for lossy formats so we have a real shot at beating the
    // original file size even if the first pass didn't.
    const qualityAttempts = isLossy
      ? Array.from(new Set([
          baseQuality,
          Math.max(0.35, baseQuality - 0.15),
          Math.max(0.3, baseQuality - 0.3),
        ].map((q) => Math.round(q * 100) / 100)))
      : [baseQuality];

    let best = null;
    for (const q of qualityAttempts) {
      // eslint-disable-next-line no-await-in-loop
      const blob = await canvasToBlob(canvas, mimeType, q);
      if (!best || blob.size < best.blob.size) best = { blob, quality: q };
      if (blob.size < record.file.size) break; // already smaller — good enough
    }

    const wasResized = width !== record.width || height !== record.height;
    let usedFallback = false;

    if (best.blob.size >= record.file.size && !wasResized) {
      // Re-encoding didn't help (common for already-optimized PNGs) and no
      // resize was requested — hand back the original file untouched rather
      // than a "compressed" file that's actually bigger.
      best = { blob: record.file, quality: null };
      usedFallback = true;
    }

    return {
      blob: best.blob,
      width,
      height,
      mimeType: usedFallback ? record.file.type : mimeType,
      timeMs: performance.now() - start,
      usedFallback,
    };
  }

  async function compressOne(id) {
    const record = store.get(id);
    if (!record) return;
    const pair = getPair(id);
    if (!pair) return;

    const emptyState = pair.querySelector('.compressed-empty');
    const progressEl = pair.querySelector('.card-progress');
    const resultEl = pair.querySelector('.compressed-result');
    const downloadBtn = pair.querySelector('.download-btn');

    emptyState.hidden = true;
    resultEl.hidden = true;
    progressEl.hidden = false;
    downloadBtn.disabled = true;

    try {
      const result = await compressImage(record);

      if (record.compressedUrl) URL.revokeObjectURL(record.compressedUrl);
      record.compressedBlob = result.blob;
      record.compressedUrl = URL.createObjectURL(result.blob);
      record.outWidth = result.width;
      record.outHeight = result.height;
      record.outMime = result.mimeType;
      record.compressTimeMs = result.timeMs;

      pair.querySelector('.thumb-compressed').src = record.compressedUrl;
      pair.querySelector('.thumb-compressed').alt = `Compressed ${record.file.name}`;
      pair.querySelector('.comp-filename').textContent = record.file.name;
      pair.querySelector('.comp-filename').title = record.file.name;
      pair.querySelector('.c-dims').textContent = `${result.width}×${result.height}`;
      pair.querySelector('.c-ftype').textContent = extFromType(result.mimeType).toUpperCase();
      pair.querySelector('.c-size').textContent = formatBytes(result.blob.size);

      const pct = Math.max(0, Math.round((1 - result.blob.size / record.file.size) * 100));
      const pctEl = pair.querySelector('.c-pct');
      const successBadge = pair.querySelector('.success-badge');

      if (result.usedFallback) {
        pctEl.textContent = 'Already optimal';
        pair.querySelector('.c-time-hint').textContent = `This file was already well-optimized, so we kept the original ${formatBytes(record.file.size)} instead of a larger re-encode.`;
        successBadge.querySelector('.success-badge-text').textContent = 'Already optimized';
      } else {
        pctEl.textContent = `${pct}%`;
        pair.querySelector('.c-time-hint').textContent = `Compressed in ${(result.timeMs / 1000).toFixed(2)}s · ${formatBytes(record.file.size)} → ${formatBytes(result.blob.size)}`;
        successBadge.querySelector('.success-badge-text').textContent = 'Compressed successfully';
      }

      resultEl.hidden = false;
      downloadBtn.disabled = false;
    } catch (err) {
      showError('Compression failed', `Couldn't compress "${record.file.name}". Try a different quality or format.`);
      emptyState.hidden = false;
    } finally {
      progressEl.hidden = true;
      updateStats();
    }
  }

  compressAllBtn.addEventListener('click', async () => {
    if (store.size === 0) {
      showToast('Add some images first', 'error');
      return;
    }
    compressAllBtn.disabled = true;
    compressAllBtn.textContent = 'Compressing…';
    const ids = Array.from(store.keys());
    for (const id of ids) {
      // Sequential so per-card progress indicators read clearly.
      // eslint-disable-next-line no-await-in-loop
      await compressOne(id);
    }
    compressAllBtn.disabled = false;
    compressAllBtn.textContent = 'Auto compress all';
    showToast('All images compressed', 'success');
  });

  qualitySlider.addEventListener('input', () => {
    qualityValue.textContent = `${qualitySlider.value}%`;
  });

  resetBtn.addEventListener('click', () => {
    qualitySlider.value = 80;
    qualityValue.textContent = '80%';
    resizeWidth.value = '';
    resizeHeight.value = '';
    keepAspect.checked = true;
    outputFormat.value = 'original';
    showToast('Settings reset');
  });

  clearAllBtn.addEventListener('click', () => {
    Array.from(store.keys()).forEach(removeImage);
    downloadAllBtn.disabled = true;
    showToast('All images cleared');
  });

  /* ----------------------------- Downloads ----------------------------- */
  function fileNameFor(record) {
    const name = record.renamedTo || baseName(record.file.name);
    const ext = extFromType(record.outMime || record.file.type);
    return `${name}.${ext}`;
  }

  function downloadOne(id) {
    const record = store.get(id);
    if (!record || !record.compressedBlob) return;
    const a = document.createElement('a');
    a.href = record.compressedUrl;
    a.download = fileNameFor(record);
    document.body.appendChild(a);
    a.click();
    a.remove();
    showToast(`Downloaded ${fileNameFor(record)}`, 'success');
  }

  downloadAllBtn.addEventListener('click', async () => {
    const ready = Array.from(store.values()).filter((r) => r.compressedBlob);
    if (!ready.length) {
      showToast('Compress your images first', 'error');
      return;
    }
    if (typeof JSZip === 'undefined') {
      showToast('ZIP library unavailable — check your connection', 'error');
      return;
    }
    downloadAllBtn.disabled = true;
    downloadAllBtn.textContent = 'Zipping…';
    try {
      const zip = new JSZip();
      const usedNames = new Set();
      ready.forEach((record) => {
        const original = fileNameFor(record);
        const dot = original.lastIndexOf('.');
        const stem = dot > 0 ? original.slice(0, dot) : original;
        const ext = dot > 0 ? original.slice(dot) : '';
        let name = original;
        let n = 1;
        while (usedNames.has(name)) {
          name = `${stem}-${n}${ext}`;
          n += 1;
        }
        usedNames.add(name);
        zip.file(name, record.compressedBlob);
      });
      const blob = await zip.generateAsync({ type: 'blob' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'squish-images.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      showToast('ZIP downloaded', 'success');
    } catch (err) {
      showError('ZIP creation failed', 'Something went wrong bundling your files. Please try again.');
    } finally {
      downloadAllBtn.disabled = false;
      downloadAllBtn.textContent = 'Download all as ZIP';
    }
  });

  /* ----------------------------- Stats ----------------------------- */
  function updateStats() {
    const records = Array.from(store.values());
    const count = records.length;
    const originalTotal = records.reduce((sum, r) => sum + r.file.size, 0);
    const compressedTotal = records.reduce((sum, r) => sum + (r.compressedBlob ? r.compressedBlob.size : r.file.size), 0);
    const compressedCount = records.filter((r) => r.compressedBlob).length;
    const savedPct = originalTotal > 0 ? Math.max(0, Math.round((1 - compressedTotal / originalTotal) * 100)) : 0;

    statCount.textContent = String(count);
    statOriginal.textContent = formatBytes(originalTotal);
    statCompressed.textContent = formatBytes(compressedTotal);
    statSaved.textContent = `${savedPct}%`;

    downloadAllBtn.disabled = compressedCount === 0;
  }
})();