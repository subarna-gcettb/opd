const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('doctor blog authoring and public blog templates compile', () => {
  const files = [
    'views/doctors/blogs/index.ejs',
    'views/doctors/blogs/new.ejs',
    'views/public/blogs.ejs',
    'views/public/blog-detail.ejs'
  ];
  for (const file of files) {
    assert.doesNotThrow(() => ejs.compile(read(file), { filename: path.join(__dirname, '..', file) }), file);
  }
});

test('blog routes require doctor portal permission, CSRF protection, and image upload validation', () => {
  const routes = read('routes/doctorPortalRoutes.js');
  const controller = read('controllers/doctorBlogController.js');
  const upload = read('utils/blogImageUpload.js');
  assert.match(routes, /router\.get\('\/blogs'.*requirePermission\('consultation\.create'\)/);
  assert.match(routes, /router\.post\('\/blogs'.*csrfProtection, blogImageUpload\.single\('image'\)/);
  assert.match(controller, /req\.user\.doctorId/);
  assert.match(controller, /Only authenticated doctors can manage doctor blogs/);
  assert.match(upload, /image\/jpeg/);
  assert.match(upload, /image\/png/);
  assert.match(upload, /image\/webp/);
  assert.match(upload, /5 \* 1024 \* 1024/);
});

test('published doctor blogs are exposed on landing page and public article routes', () => {
  const migration = read('database/migrations/1011_create_doctor_blogs.sql');
  const service = read('services/blogService.js');
  const controller = read('controllers/publicController.js');
  const routes = read('routes/publicRoutes.js');
  const home = read('views/public/home.ejs');
  const nav = read('views/partials/public-nav.ejs');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS doctor_blogs/);
  assert.match(migration, /status ENUM\('DRAFT','PUBLISHED'\)/);
  assert.match(service, /WHERE b\.status = 'PUBLISHED' AND b\.published_at IS NOT NULL/);
  assert.match(service, /youtube-nocookie/);
  assert.match(controller, /blogService\.listPublished\(3\)/);
  assert.match(routes, /router\.get\('\/blog', asyncHandler\(publicController\.blogs\)\)/);
  assert.match(routes, /router\.get\('\/blog\/:slug', asyncHandler\(publicController\.blogDetail\)\)/);
  assert.match(home, /blog-home-section/);
  assert.match(nav, /href="\/blog"/);
});

test('blog articles escape author-provided text and only embed validated YouTube IDs', () => {
  const detail = read('views/public/blog-detail.ejs');
  const service = read('services/blogService.js');
  assert.match(detail, /<%= post\.content %>/);
  assert.match(detail, /youtube-nocookie\.com\/embed\/<%= post\.youtube_video_id %>/);
  assert.match(service, /\^\[A-Za-z0-9_-\]\{11\}\$/);
  assert.match(service, /host === 'youtube\.com'/);
});

test('YouTube link parser accepts common YouTube formats and rejects unrelated hosts', () => {
  const { youtubeVideoId } = require('../services/blogService');
  assert.equal(youtubeVideoId('https://www.youtube.com/watch?v=abcdefghijk'), 'abcdefghijk');
  assert.equal(youtubeVideoId('https://youtu.be/abcdefghijk'), 'abcdefghijk');
  assert.equal(youtubeVideoId('https://youtube.com/shorts/abcdefghijk'), 'abcdefghijk');
  assert.equal(youtubeVideoId('https://example.com/watch?v=abcdefghijk'), null);
  assert.equal(youtubeVideoId('javascript:alert(1)'), null);
  assert.equal(youtubeVideoId('https://youtube.com/watch?v=short'), null);
});

test('doctor dashboard displays a prominent blog-writing panel with direct links', () => {
  const dashboard = read('views/doctors/portal-dashboard.ejs');
  assert.match(dashboard, /Health Blog Publishing/);
  assert.match(dashboard, /href="\/doctor\/blogs"/);
  assert.match(dashboard, /href="\/doctor\/blogs\/new"/);
  assert.match(dashboard, /Write a Blog/);
});
