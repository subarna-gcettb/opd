const bwipjs = require('bwip-js');

/**
 * Generates a Code128 barcode PNG encoding ONLY the given value.
 * Callers must pass the patient's Health ID and nothing else — never
 * diagnosis, medicine, Aadhaar, address, or any other medical/PII field.
 *
 * @param {string} value - the safe identifier to encode (Health ID)
 * @returns {Promise<Buffer>} PNG image buffer
 */
async function generateCode128(value) {
  if (!value || !/^[0-9A-Za-z]+$/.test(value)) {
    throw new Error('Barcode value must be a plain alphanumeric identifier');
  }
  return bwipjs.toBuffer({
    bcid: 'code128',
    text: value,
    scale: 3,
    height: 12,
    includetext: true,
    textxalign: 'center'
  });
}

/** Returns a data: URI so it can be embedded directly in an <img> tag. */
async function generateCode128DataUri(value) {
  const png = await generateCode128(value);
  return `data:image/png;base64,${png.toString('base64')}`;
}

module.exports = { generateCode128, generateCode128DataUri };
