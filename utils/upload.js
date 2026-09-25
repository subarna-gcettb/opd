const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads', 'branding');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomBytes(8).toString('hex')}${ext}`);
  }
});

const ALLOWED = new Set(['.png', '.jpg', '.jpeg', '.svg', '.webp', '.ico']);

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED.has(ext)) {
    return cb(new Error('Only PNG, JPG, SVG, WEBP, or ICO images are allowed'));
  }
  cb(null, true);
}

const uploadImage = multer({
  storage,
  fileFilter,
  limits: { fileSize: 2 * 1024 * 1024 } // 2MB
});

/** Public URL path for a file saved by uploadImage. */
function publicUrlFor(filename) {
  return `/uploads/branding/${filename}`;
}

module.exports = { uploadImage, publicUrlFor };
