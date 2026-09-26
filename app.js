require('dotenv').config();

const express = require('express');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const MySQLStoreFactory = require('express-mysql-session');
const methodOverride = require('method-override');
const flash = require('connect-flash');
const expressLayouts = require('express-ejs-layouts');
const rateLimit = require('express-rate-limit');

const appConfig = require('./config/appConfig');
const { attachUser } = require('./middleware/auth');
const { attachClientIp } = require('./middleware/audit');
const { exposeCsrfToken } = require('./middleware/csrf');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const settingsService = require('./services/settingsService');

const app = express();
const MySQLStore = MySQLStoreFactory(session);
// Own dedicated (non-promise) connection for the session store — kept
// separate from the app's mysql2/promise pool used everywhere else.
const sessionStore = new MySQLStore({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  schema: {
    tableName: 'sessions',
    columnNames: { session_id: 'session_id', expires: 'expires', data: 'data' }
  }
});

app.disable('x-powered-by');
app.set('trust proxy', 1);

// ---- View engine ----------------------------------------------------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layouts/main');

// ---- Security headers -------------------------------------------------
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'cdn.jsdelivr.net'],
        // 'unsafe-inline' is required: views use inline <script> blocks
        // (booking cascade, dynamic prescription rows, dashboard chart)
        // and onclick= handlers (print buttons). Without it the browser
        // silently drops all of that JS and pages look "broken" with no
        // console-visible server error.
        scriptSrc: ["'self'", "'unsafe-inline'", 'cdn.jsdelivr.net'],
        imgSrc: ["'self'", 'data:', 'https://images.pexels.com'],
        fontSrc: ["'self'", 'cdn.jsdelivr.net']
      }
    }
  })
);
app.use(compression());

// ---- Body / cookies ----------------------------------------------------
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(methodOverride('_method'));

// ---- Static assets -------------------------------------------------
app.use(express.static(path.join(__dirname, 'public')));

// ---- Sessions ------------------------------------------------------
app.use(
  session({
    key: 'hms.sid',
    secret: appConfig.session.secret,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: appConfig.isProd,
      maxAge: appConfig.session.maxAgeMs
    }
  })
);
app.use(flash());

// ---- Request-scoped helpers -----------------------------------------
app.use(attachClientIp);
app.use(attachUser);
app.use(exposeCsrfToken);

// ---- Global view locals ----------------------------------------------
app.use(async (req, res, next) => {
  res.locals.appName = appConfig.appName;
  res.locals.currentPath = req.path;
  res.locals.flashErrors = req.flash('errors');
  res.locals.flashSuccess = req.flash('success');
  res.locals.formData = req.flash('formData')[0] || {};
  try {
    res.locals.siteSettings = await settingsService.getSettings();
  } catch (err) {
    // Never let a settings-lookup failure take down every page — fall
    // back to defaults and keep going.
    res.locals.siteSettings = settingsService.DEFAULTS;
  }
  next();
});

// ---- Rate limiting for auth ------------------------------------------
const loginLimiter = rateLimit({
  windowMs: appConfig.rateLimit.loginWindowMs,
  max: appConfig.rateLimit.loginMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many login attempts. Please try again later.'
});
app.use('/auth/login', loginLimiter);

// ---- Routes ----------------------------------------------------------
app.use('/auth', require('./routes/authRoutes'));
app.use('/dashboard', require('./routes/dashboardRoutes'));
app.use('/patients', require('./routes/patientRoutes'));
app.use('/patient-portal', require('./routes/patientPortalRoutes'));
app.use('/doctors', require('./routes/doctorRoutes'));
app.use('/opd', require('./routes/opdRoutes'));
app.use('/doctor', require('./routes/doctorPortalRoutes'));
app.use('/prescriptions', require('./routes/prescriptionRoutes'));
app.use('/billing', require('./routes/billingRoutes'));
app.use('/admin', require('./routes/adminRoutes'));
app.use('/reports', require('./routes/reportRoutes'));
app.use('/scan', require('./routes/scanRoutes'));

app.get('/manifest.json', async (req, res, next) => {
  try {
    const settings = await settingsService.getSettings();
    const icon = settings.logo_path || '/images/pwa-icon-512.svg';
    res.json({
      name: settings.hospital_name + ' HMS',
      short_name: settings.hospital_name,
      description: settings.seo_description,
      start_url: '/',
      scope: '/',
      id: '/',
      display_override: ['window-controls-overlay', 'standalone'],
      display: 'standalone',
      background_color: '#0a3d3d',
      theme_color: '#0d6e6e',
      orientation: 'portrait-primary',
      icons: [
        { src: settings.logo_path || '/images/pwa-icon-192.svg', sizes: '192x192', type: settings.logo_path ? 'image/png' : 'image/svg+xml', purpose: 'any maskable' },
        { src: icon, sizes: '512x512', type: settings.logo_path ? 'image/png' : 'image/svg+xml', purpose: 'any maskable' }
      ]
    });
  } catch (err) {
    next(err);
  }
});

app.get('/splash', (req, res) => {
  res.render('splash', { layout: 'layouts/landing', title: 'Loading…' });
});

app.use('/', require('./routes/publicRoutes'));

// ---- 404 / error handling ---------------------------------------------
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
