const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');

const { PORT, SESSION_SECRET } = require('./config');
const db = require('./db');
const authRoutes = require('./routes/auth');
const emailRoutes = require('./routes/emails');
const settingsRoutes = require('./routes/settings');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser(SESSION_SECRET));

app.use('/auth', authRoutes);
app.use('/api', emailRoutes);
app.use('/api', settingsRoutes);

app.use(express.static(path.join(__dirname, '..', 'public')));

// Recover any email stuck in "sending" after a previous crash/restart.
db.recoverSending();

app.listen(PORT, () => {
  console.log(`Mailer running at http://localhost:${PORT}`);
});
