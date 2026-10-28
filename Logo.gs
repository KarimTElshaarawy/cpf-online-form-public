/*******************************************************************
 * Logo.gs - the institution logo, embedded so pages, emails and the PDF
 * never depend on an outside image host.
 *
 * INCLUDE HERE: replace LOGO_B64 with the base64 text of your own logo (a PNG
 * about 327x36). The placeholder below is a 1x1 transparent pixel, so no logo shows.
 *******************************************************************/

var LOGO_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/** For HTML pages and the PDF: <img src="..."> */
function logoDataUri_() {
  return 'data:image/png;base64,' + LOGO_B64;
}

let LOGO_BLOB_ = null;

/** For emails: Gmail blocks data: images, so send as an inline cid: image (decoded once per run). */
function logoBlob_() {
  if (!LOGO_BLOB_) LOGO_BLOB_ = Utilities.newBlob(Utilities.base64Decode(LOGO_B64), 'image/png', 'logo.png');
  return LOGO_BLOB_;
}
