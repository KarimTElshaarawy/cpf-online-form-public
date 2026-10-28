/*******************************************************************
 * Signatures.gs - how every signature is taken, kept and deleted.
 *
 * Every signer (Exchange Office at Step I, head of department, faculty reviewer,
 * each Step III / IV approver and the student) chooses Type, Draw or Upload:
 *   Type    the typed full name is the signature (the name is required).
 *   Draw    a PNG drawn on the page (the name is optional).
 *   Upload  a saved PNG/JPG picture, turned into a PNG in the browser and then
 *           handled exactly like a drawing (the name is optional).
 * The CPF PDF shows one signature per line: the typed name OR the picture.
 * Below, "drawn" images include uploaded ones.
 *
 * DRAWN SIGNATURE IMAGES ARE TEMPORARY AND PRIVATE:
 *   - Saved as PNG files in ONE private Drive folder of the script owner
 *     (CFG.SIGNATURE_FOLDER_NAME, id in the SIG_FOLDER_ID property). The
 *     folder and the files are never shared and no link is ever made.
 *   - The Sheet keeps only the file id (<prefix>_sig_file) and the method
 *     (<prefix>_sig_method). plain_() strips every *_sig_file value from
 *     whatever goes to a browser, and no function returns an image.
 *   - The images are read ONLY by buildPdf_ (Phase2_Chain.gs) through
 *     signatureImageForPdf_ below, when the FINAL signed PDF is built.
 *     Both end in "_", so google.script.run cannot call them.
 *   - Once that PDF is built, saved and emailed, every image of the form
 *     is deleted (finishFinalPdf_), the file ids are cleared, and the
 *     method becomes "drawn signature, image deleted on <date>".
 *   - cleanupSignatureImages (daily trigger) deletes the images of forms
 *     that are denied or cancelled, and any file in the folder that no
 *     row points to. Forms in progress are never cleaned up for age.
 * Deleting uses the Drive advanced service (appsscript.json) to delete
 * permanently; if it is not enabled, files are moved to the Drive trash
 * (emptied automatically by Google after 30 days).
 *
 * Column prefixes: Submissions s1, ADV, DEAN, FIN, SPON, Exchange Office, REG, student;
 * Courses hod, faculty.
 *******************************************************************/

// ------------------------------------------------ what the browser sends

/** True when the bytes start with the 8-byte PNG signature (Apps Script bytes are signed). */
function isPng_(bytes) {
  const sig = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  return !!bytes && bytes.length > sig.length && sig.every((b, i) => (bytes[i] & 0xff) === b);
}

/**
 * A signature as a page sends it: { method: 'typed' | 'drawn', name, image }.
 * A plain string (the self test, a page open from before an update) is a typed
 * signature. Nothing from the browser is trusted: a drawn signature must be a
 * real PNG data URL of at most CFG.SIGNATURE_MAX_KB.
 * Returns { name, method, png } (png = decoded bytes, drawn only).
 */
function signatureInput_(v, message) {
  const o = v && typeof v === 'object' ? v : { method: 'typed', name: v };
  // Each method requires only its own input (Oct 15, 2026): Type needs the full name, Draw needs
  // a drawing, Upload needs a picture (both checked below). For Draw / Upload the name is optional;
  // without one, a plain label is kept instead.
  const method = o.method === 'drawn' || o.method === 'uploaded' ? o.method : 'typed';
  if (method === 'typed') return { name: signature_(o.name, message), method: 'typed', png: null };
  const name = str_(o.name) ? signature_(o.name, message) : (method === 'drawn' ? 'Drawn signature' : 'Uploaded signature');
  const again = method === 'drawn' ? 'Press Clear and draw it again' : 'Choose another image file';
  const unreadable = 'The ' + method + ' signature could not be read. ' + again + ', or choose Type.';
  const tooLarge = 'The ' + method + ' signature is too large. ' + again + (method === 'drawn' ? ', a little smaller.' : ' (a smaller picture).');
  const maxBytes = CFG.SIGNATURE_MAX_KB * 1024;
  const data = typeof o.image === 'string' ? o.image : '';
  const prefix = 'data:image/png;base64,';
  if (data.indexOf(prefix) !== 0) throw new Error(unreadable);
  const b64 = data.slice(prefix.length);
  if (b64.length > Math.ceil(maxBytes / 3) * 4 + 4) throw new Error(tooLarge);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw new Error(unreadable);
  let png;
  try { png = Utilities.base64Decode(b64); } catch (e) { throw new Error(unreadable); }
  if (png.length > maxBytes) throw new Error(tooLarge);
  if (png.length < 60 || !isPng_(png)) throw new Error(unreadable);
  return { name: name, method: method, png: png };
}

/**
 * The cells to write for one signature: <prefix>_sig_method and <prefix>_sig_file.
 * A drawn image is saved to the private folder here, so call this under the lock,
 * after every other check has passed.
 */
function signaturePatch_(sheetName, sid, prefix, input) {
  const patch = {};
  patch[prefix + '_sig_method'] = input.method;
  patch[prefix + '_sig_file'] = '';
  if (input.method === 'drawn' || input.method === 'uploaded') {
    const col = table_(sheetName).col;
    if (!((prefix + '_sig_file') in col) || !((prefix + '_sig_method') in col)) {
      throw new Error('Drawn signatures cannot be saved yet (the Exchange Office needs to run CPF menu > Set up / repair tabs). ' +
        'Please choose Type for now.');
    }
    patch[prefix + '_sig_file'] = saveSignatureImage_(sid, prefix, input.png);
  }
  return patch;
}

/** Saves one PNG in the private folder and returns its file id. No sharing is ever set. */
function saveSignatureImage_(sid, prefix, png) {
  const name = 'sig_' + sid + '_' + prefix + '_' + Utilities.formatDate(new Date(), CFG.TZ, 'yyyyMMdd-HHmmss') + '.png';
  return signatureFolder_().createFile(Utilities.newBlob(png, 'image/png', name)).getId();
}

// ------------------------------------------------ the private folder

/**
 * The private signature folder, by its saved id (SIG_FOLDER_ID). Without one, a
 * same-named folder is adopted only if the script owner owns it and it is shared with
 * nobody; otherwise a fresh one is created (ownedFolder_ in Util.gs). Drive also lists
 * folders other people share with the owner, and adopting one of those would hand
 * them the images.
 */
function signatureFolder_() {
  return ownedFolder_('SIG_FOLDER_ID', CFG.SIGNATURE_FOLDER_NAME);
}

/** The folder when its saved id still opens and it is not in the trash; otherwise null. */
function signatureFolderIfAny_() {
  const id = prop_('SIG_FOLDER_ID');
  if (!id) return null;
  try {
    const f = DriveApp.getFolderById(id);
    return f.isTrashed() ? null : f;
  } catch (e) {
    return null;
  }
}

/** True when the file sits in the signature folder. Nothing outside it is ever read or deleted. */
function inSignatureFolder_(file) {
  const folderId = prop_('SIG_FOLDER_ID');
  if (!folderId) return false;
  const parents = file.getParents();
  while (parents.hasNext()) if (parents.next().getId() === folderId) return true;
  return false;
}

// ------------------------------------------------ where a form's signatures are

/** Every signature slot of a form: { sheet, row, prefix }. */
function signatureSlots_(sub) {
  const slots = [];
  ['s1'].concat(STAGES.map(s => s.key), ['student']).forEach(p => slots.push({ sheet: CFG.SHEETS.SUB, row: sub, prefix: p }));
  coursesFor_(sub.submission_id).forEach(c =>
    ['hod', 'faculty'].forEach(p => slots.push({ sheet: CFG.SHEETS.CRS, row: c, prefix: p })));
  return slots;
}

/** The slots that still point at a stored image. */
function storedSignatureSlots_(sub) {
  return signatureSlots_(sub).filter(s => str_(s.row[s.prefix + '_sig_file']));
}

/** 'drawn' or 'typed' for display ('' when nobody has signed). Never anything about the image. */
function sigMethodLabel_(method, signature) {
  if (!str_(signature)) return '';
  return /^uploaded/i.test(str_(method)) ? 'uploaded' : /^drawn/i.test(str_(method)) ? 'drawn' : 'typed';
}

/**
 * "Signed by Jane Doe (College/School Designate) on 01 Oct 2026, 10:00 (drawn)": all that
 * emails ever show of a signature. Never the picture and never the IP address.
 */
function signedText_(name, at, method, role) {
  if (!str_(name)) return '';
  return 'Signed by ' + name + (role ? ' (' + role + ')' : '') + (at ? ' on ' + at : '') +
    ' (' + (method || 'typed') + ')';
}

// ------------------------------------------------ the final PDF only

/**
 * PRIVATE to buildPdf_: the drawn image as a data URI to draw into the final PDF.
 * The trailing "_" keeps it out of google.script.run, so no page can ask for it.
 * Only files inside the signature folder are read. '' when unavailable.
 */
function signatureImageForPdf_(fileId) {
  if (!str_(fileId)) return '';
  try {
    const file = DriveApp.getFileById(str_(fileId));
    if (!inSignatureFolder_(file)) return '';
    const bytes = file.getBlob().getBytes();
    if (!isPng_(bytes) || bytes.length > CFG.SIGNATURE_MAX_KB * 1024) return '';
    return 'data:image/png;base64,' + Utilities.base64Encode(bytes);
  } catch (e) {
    console.warn('A signature image could not be read for the PDF.');
    return '';
  }
}

/**
 * One signature as the PDF shows it (HTML). Drawn images appear only when
 * withImages is true, i.e. in the final signed PDF.
 */
function pdfSignatureHtml_(name, method, fileId, withImages) {
  if (!str_(name)) return '';
  const m = str_(method);
  // One signature per cell (Oct 2026): the typed name, OR the drawn / uploaded image, never both.
  if (!/^(drawn|uploaded)/i.test(m)) return esc_(name);
  const uri = withImages && (m === 'drawn' || m === 'uploaded') ? signatureImageForPdf_(fileId) : '';
  if (uri) return '<img src="' + uri + '" style="display:block;max-height:22px;max-width:120px">';
  // The image is gone ("drawn signature, image deleted on <date>" or carried into an amendment
  // as "... see original signed PDF CPF-..."): the note itself stands in for the picture.
  const note = m === 'drawn' || m === 'uploaded' ? m + ' signature, see original signed PDF' : m;
  return '<span class="m">' + esc_(note.charAt(0).toUpperCase() + note.slice(1)) + '</span>';
}

// ------------------------------------------------ finishing and deleting

/** The Drive file id inside a Drive URL, or ''. */
function driveIdFromUrl_(url) {
  const m = /\/d\/([-\w]{20,})/.exec(str_(url)) || /[?&]id=([-\w]{20,})/.exec(str_(url));
  return m ? m[1] : '';
}

/**
 * The end of a completed form: build the final signed PDF (or REUSE the stored one,
 * never rebuilding it), save it, email it, and only when all of that worked delete
 * the signature images. Anything that fails keeps the images so retryFinalPdfs can
 * finish the job, and is logged. Returns a short status line.
 */
function finishFinalPdf_(sub) {
  let pdf = null;
  const storedId = driveIdFromUrl_(sub.pdf_url);
  if (storedId) {
    try { pdf = DriveApp.getFileById(storedId).getBlob(); } catch (e) { pdf = null; }
  }
  if (!pdf) {
    try {
      pdf = buildPdf_(sub, true);
      update_(CFG.SHEETS.SUB, sub, { pdf_url: subFolder_(sub).createFile(pdf).getUrl() });
    } catch (e) {
      console.error('pdf failed: ' + e);
      log_(sub.submission_id, 'system', 'PDF_FAILED', String(e) + ' (signature images kept for a retry)');
      return 'PDF could not be built or saved; signature images kept (' + e + ')';
    }
  }
  if (!sub.pdf_sent_at) {
    if (!mailCompleted_(sub, pdf)) {
      log_(sub.submission_id, 'system', 'PDF_EMAIL_FAILED', 'signature images kept for a retry');
      return 'PDF saved, but the email failed; signature images kept';
    }
    update_(CFG.SHEETS.SUB, sub, { pdf_sent_at: new Date() });
  }
  const n = purgeSignatureImages_(sub, 'final signed PDF built, saved and sent');
  return 'PDF saved and sent' + (n ? '; ' + n + ' signature image(s) deleted' : '');
}

/**
 * Deletes one signature file: permanently through the Drive advanced service when it
 * is enabled, otherwise by moving it to the Drive trash. Files outside the signature
 * folder are never touched (a hand-edited id cannot delete anything else).
 * Returns how it went, or '' when the file exists but could not be deleted.
 */
function deleteSignatureFile_(id) {
  const file = (() => { try { return DriveApp.getFileById(id); } catch (e) { return null; } })();
  if (!file) return 'already gone';
  if (!inSignatureFolder_(file)) return 'not in the signature folder, left alone';
  try {
    Drive.Files.remove(id);
    return 'permanently deleted';
  } catch (e) {
    console.log('Permanent delete not available (' + e + '); moving to the trash.');
  }
  try {
    file.setTrashed(true);
    return 'moved to the Drive trash';
  } catch (e) {
    return '';
  }
}

/**
 * Deletes every stored signature image of a form, clears the file ids and records
 * "drawn signature, image deleted on <date>" in their place. A file that could not
 * be deleted keeps its id, so the next cleanup tries again. Returns how many were deleted.
 */
function purgeSignatureImages_(sub, reason) {
  const slots = storedSignatureSlots_(sub);
  if (!slots.length) return 0;
  const result = {};
  slots.forEach(s => {
    const id = str_(s.row[s.prefix + '_sig_file']);
    if (!(id in result)) result[id] = deleteSignatureFile_(id);
  });
  const deletedOn = ' signature, image deleted on ' + Utilities.formatDate(new Date(), CFG.TZ, 'dd MMM yyyy');
  slots.forEach(s => {
    if (!result[str_(s.row[s.prefix + '_sig_file'])]) return;
    const patch = {};
    patch[s.prefix + '_sig_file'] = '';
    patch[s.prefix + '_sig_method'] = (/^uploaded/i.test(str_(s.row[s.prefix + '_sig_method'])) ? 'uploaded' : 'drawn') + deletedOn;
    update_(s.sheet, s.row, patch);
  });
  const ids = Object.keys(result);
  const deleted = ids.filter(id => result[id]).length;
  const how = ids.map(id => result[id]).filter((v, i, all) => v && all.indexOf(v) === i);
  log_(sub.submission_id, 'system', deleted === ids.length ? 'SIGNATURE_IMAGES_DELETED' : 'SIGNATURE_IMAGES_PARTLY_DELETED',
    { deleted: deleted, kept: ids.length - deleted, how: how.join(', '), reason: reason });
  return deleted;
}

/**
 * Daily trigger (CPF menu > Install triggers) and CPF menu item. Deletes ONLY:
 *   - the signature images of forms that are DENIED or CANCELLED, and
 *   - files in the folder that no Sheet row points to (orphans).
 * A form still in progress is NEVER cleaned up because it is old: its images stay in
 * the private folder until it is cancelled, denied or completed. Completed forms are
 * left to finishFinalPdf_ / retryFinalPdfs, which delete only after the final PDF is
 * saved and sent.
 */
function cleanupSignatureImages(e) {
  requireAdminOrTrigger_(e);
  return withLock_(() => {
    const folder = signatureFolderIfAny_();
    if (!folder) {
      const none = 'No signature folder yet, so there is nothing to clean up.';
      toast_(none);
      return none;
    }
    const referenced = new Set();
    let forms = 0, images = 0;
    readAll_(CFG.SHEETS.SUB).forEach(sub => {
      if (!storedSignatureSlots_(sub).length) return;
      if (sub.status === STATUS.DENIED || sub.status === STATUS.CANCELLED) {
        images += purgeSignatureImages_(sub, 'form ' + String(sub.status).toLowerCase());
        forms++;
      }
      storedSignatureSlots_(sub).forEach(s => referenced.add(str_(s.row[s.prefix + '_sig_file'])));
    });

    // Files no row points to: a review that was redone, "Change my courses", a deleted row.
    let orphans = 0;
    const permanent = typeof Drive !== 'undefined';
    const it = folder.getFiles();
    while (it.hasNext()) {
      const f = it.next();
      if (referenced.has(f.getId())) continue;
      if (f.isTrashed() && !permanent) continue;   // already in the trash; Google empties it
      if (deleteSignatureFile_(f.getId())) orphans++;
    }
    const msg = 'Signature cleanup: ' + images + ' image(s) deleted from ' + forms + ' form(s), ' +
      orphans + ' unreferenced file(s) deleted.';
    log_('', 'system', 'SIGNATURE_CLEANUP', msg);
    toast_(msg);
    return msg;
  });
}

/**
 * Editor / CPF menu: finishes every COMPLETED form whose PDF could not be built, saved or
 * emailed: one that still holds signature images, or one with no saved PDF at all (a form
 * signed only with typed signatures holds no images, so it needs the second test). Reuses a
 * stored PDF, emails it if it was never sent, then deletes any images. Safe to run again.
 */
function retryFinalPdfs() {
  requireAdmin_();
  return withLock_(() => {
    const lines = [];
    readAll_(CFG.SHEETS.SUB).forEach(sub => {
      if (sub.status !== STATUS.COMPLETED) return;
      if (!storedSignatureSlots_(sub).length && str_(sub.pdf_url)) return;
      lines.push(sub.submission_id + ': ' + finishFinalPdf_(sub));
    });
    const msg = lines.length ? lines.join('\n') : 'No completed form is waiting for its final PDF.';
    console.log(msg);
    toast_(lines.length ? lines.length + ' form(s) processed, see the Execution log.' : msg);
    return msg;
  });
}
