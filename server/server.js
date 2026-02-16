const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const db = require('./database');
const processEnv = process.env;

const app = express();

// Load .env if present (no external deps)
function loadEnvFromFile() {
    try {
        const envPath = path.join(__dirname, '.env');
        if (fs.existsSync(envPath)) {
            const content = fs.readFileSync(envPath, 'utf8');
            content.split(/\r?\n/).forEach(line => {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#')) return;
                const eq = trimmed.indexOf('=');
                if (eq > -1) {
                    const key = trimmed.slice(0, eq).trim();
                    const val = trimmed.slice(eq + 1).trim();
                    if (key && (typeof processEnv[key] === 'undefined' || processEnv[key] === '')) {
                        processEnv[key] = val;
                    }
                }
            });
            console.log('Loaded environment variables from .env');
        }
    } catch (e) {
        console.warn('Failed to load .env:', e.message);
    }
}
loadEnvFromFile();

const PORT = processEnv.PORT ? parseInt(processEnv.PORT, 10) : 3000;
// Middleware
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    // Allow any localhost/127.0.0.1 origin
    if (origin.indexOf('localhost') !== -1 || origin.indexOf('127.0.0.1') !== -1) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Configure Multer for Image Uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// Email Configuration (Nodemailer)
function createTransporter() {
    if (processEnv.SMTP_USER && processEnv.SMTP_PASS) {
        const t = nodemailer.createTransport({
            host: processEnv.SMTP_HOST || 'smtp.gmail.com',
            port: parseInt(processEnv.SMTP_PORT || '587', 10),
            secure: processEnv.SMTP_SECURE === 'true' ? true : false,
            auth: {
                user: processEnv.SMTP_USER,
                pass: processEnv.SMTP_PASS
            }
        });
        t.verify().then(() => {
            console.log('SMTP transport verified');
        }).catch(err => {
            console.warn('SMTP verify failed:', err.message);
        });
        return t;
    }
    return null;
}
let transporter = createTransporter();

// ========== Admin Auth Config ==========
const ADMIN_EMAIL = processEnv.ADMIN_EMAIL || '';
const ADMIN_PASSWORD_HASH = processEnv.ADMIN_PASSWORD_HASH || '';
const ADMIN_PASSWORD = processEnv.ADMIN_PASSWORD || '';
const JWT_SECRET = processEnv.JWT_SECRET || 'dev-secret-change-me';

function getAdminHash() {
  if (ADMIN_PASSWORD_HASH) return ADMIN_PASSWORD_HASH;
  if (ADMIN_PASSWORD) return bcrypt.hashSync(ADMIN_PASSWORD, 10);
  return null;
}
const ADMIN_HASH = getAdminHash();

function signToken(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verifyToken(token) {
  try {
    const [data, sig] = token.split('.');
    if (!data || !sig) return null;
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(data).digest('base64url');
    if (sig !== expected) return null;
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return header.split(';').reduce((acc, part) => {
    const [k, v] = part.trim().split('=');
    if (k && v) acc[k] = decodeURIComponent(v);
    return acc;
  }, {});
}

function adminAuth(req, res, next) {
  const cookies = parseCookies(req);
  const token = cookies['admin_token'];
  const payload = token ? verifyToken(token) : null;
  if (!payload || payload.email !== ADMIN_EMAIL) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

// --- API ROUTES ---

// --- STATIC (Protected Admin) ---
// const FRONTEND_DIR = path.join(__dirname, '..');
const FRONTEND_DIR = path.join(__dirname)

app.get('/admin/login', (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, 'admin', 'login', 'index.html'));
});

app.get('/admin.html', (req, res) => {
  const cookies = parseCookies(req);
  const token = cookies['admin_token'];
  const payload = token ? verifyToken(token) : null;
  if (!payload || payload.email !== ADMIN_EMAIL) {
    res.redirect('/admin/login');
    return;
  }
  res.sendFile(path.join(FRONTEND_DIR, 'admin.html'));
});

// Gate all /admin/* except /admin/login
app.use('/admin', (req, res, next) => {
  if (req.path.startsWith('/login')) return next();
  const cookies = parseCookies(req);
  const token = cookies['admin_token'];
  const payload = token ? verifyToken(token) : null;
  if (!payload || payload.email !== ADMIN_EMAIL) {
    res.redirect('/admin/login');
    return;
  }
  next();
}, express.static(path.join(FRONTEND_DIR, 'admin')));

// Serve remaining static assets and pages (placed after API routes)

// Diagnostics (non-sensitive)
app.get('/api/_smtp', (req, res) => {
  res.json({
    hasUser: !!processEnv.SMTP_USER,
    hasPass: !!processEnv.SMTP_PASS,
    transporterActive: !!transporter
  });
});

app.get('/api/_env', (req, res) => {
  const user = processEnv.SMTP_USER || '';
  const pass = processEnv.SMTP_PASS || '';
  res.json({
    user_set: !!user,
    pass_set: !!pass,
    user_len: user.length,
    pass_len: pass.length
  });
});

// Admin login
app.post('/api/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!ADMIN_EMAIL || !ADMIN_HASH) {
      res.status(500).json({ error: 'Admin credentials not configured' });
      return;
    }
    if (email !== ADMIN_EMAIL) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    const ok = await bcrypt.compare(password, ADMIN_HASH);
    if (!ok) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    const payload = { email, exp: Date.now() + 1000 * 60 * 60 * 2 }; // 2h
    const token = signToken(payload);
    const secure = (processEnv.NODE_ENV === 'production');
    const cookie = [
      `admin_token=${encodeURIComponent(token)}`,
      'HttpOnly',
      'SameSite=Lax',
      `Path=/`,
      secure ? 'Secure' : ''
    ].filter(Boolean).join('; ');
    res.setHeader('Set-Cookie', cookie);
    res.json({ message: 'Login successful' });
  } catch (e) {
    res.status(500).json({ error: 'Login failed' });
  }
});

// Admin me
app.get('/api/admin/me', (req, res) => {
  const cookies = parseCookies(req);
  const token = cookies['admin_token'];
  const payload = token ? verifyToken(token) : null;
  if (!payload || payload.email !== ADMIN_EMAIL) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  res.json({ email: payload.email });
});

// Admin logout
app.post('/api/admin/logout', (req, res) => {
  const secure = (processEnv.NODE_ENV === 'production');
  const cookie = [
    `admin_token=`,
    'HttpOnly',
    'SameSite=Lax',
    `Path=/`,
    'Max-Age=0',
    secure ? 'Secure' : ''
  ].filter(Boolean).join('; ');
  res.setHeader('Set-Cookie', cookie);
  res.json({ message: 'Logged out' });
});
// 1. Get All Products
app.get('/api/products', (req, res) => {
    const { category, best_seller, sort } = req.query;
    let sql = "SELECT * FROM products";
    const conditions = [];
    const params = [];
    
    if (category) {
        conditions.push("category = ?");
        params.push(category);
    }
    if (typeof best_seller !== 'undefined') {
        conditions.push("best_seller = ?");
        params.push(parseInt(best_seller, 10) ? 1 : 0);
    }
    if (conditions.length) {
        sql += " WHERE " + conditions.join(" AND ");
    }
    if (sort === 'newest') {
        sql += " ORDER BY created_at DESC";
    }
    
    db.all(sql, params, (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

// 2. Add New Product (Admin)
app.post('/api/products', adminAuth, upload.single('image'), (req, res) => {
    const { name, category, price, description, stock } = req.body;
    // If an image is uploaded, use the local path; otherwise use a placeholder or provided URL
    // const imagePath = req.file ? `http://localhost:${PORT}/uploads/${req.file.filename}` : req.body.imageUrl;
    const baseUrl = `${req.protocol}://${req.get('host')}`;
const imagePath = req.file ? `${baseUrl}/uploads/${req.file.filename}` : req.body.imageUrl;

    const hoverImage = req.body.hoverImage || imagePath; // Simplify for now

    const sql = "INSERT INTO products (name, category, price, image, hoverImage, description, stock) VALUES (?, ?, ?, ?, ?, ?, ?)";
    const params = [name, category, price, imagePath, hoverImage, description, stock];

    db.run(sql, params, function(err) {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({
            message: "Product added successfully",
            id: this.lastID,
            product: { id: this.lastID, name, category, price, image: imagePath }
        });
    });
});

// 3. Update Product
app.put('/api/products/:id', adminAuth, upload.single('image'), (req, res) => {
    const { name, category, price, description, stock, imageUrl } = req.body;
    let imagePath = imageUrl;
    if (req.file) {
        imagePath = `http://localhost:${PORT}/uploads/${req.file.filename}`;
    }

    const sql = `UPDATE products SET name = ?, category = ?, price = ?, description = ?, stock = ?, image = ? WHERE id = ?`;
    const params = [name, category, price, description, stock, imagePath, req.params.id];

    db.run(sql, params, function(err) {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ message: "Product updated successfully" });
    });
});

// 4. Delete Product
app.delete('/api/products/:id', adminAuth, (req, res) => {
    db.run("DELETE FROM products WHERE id = ?", req.params.id, function(err) {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ message: "Product deleted successfully" });
    });
});

// 5. Place Order & Send Email
app.post('/api/orders', (req, res) => {
    const { customer_name, email, phone, address, total_amount, items } = req.body;
    const itemsJson = JSON.stringify(items);

    const sql = "INSERT INTO orders (customer_name, email, phone, address, total_amount, items) VALUES (?, ?, ?, ?, ?, ?)";
    const params = [customer_name, email, phone, address, total_amount, itemsJson];

    db.run(sql, params, function(err) {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        
        const orderId = this.lastID;

        // Send Email to Admin
        const adminEmail = 'hanzalak395@gmail.com';
        const orderItemsList = items.map(it => `${it.qty}x ${it.name} - $${(it.price * it.qty).toFixed(2)}`).join('\n');
        const htmlList = items.map(it => `<li>${it.qty}x ${it.name} - $${(it.price * it.qty).toFixed(2)}</li>`).join('');
        const mailOptions = {
            from: processEnv.SMTP_USER || 'no-reply@veloce.store',
            to: adminEmail,
            subject: `New Order #${orderId} - ${customer_name}`,
            text: `Order #${orderId}\n\nCustomer: ${customer_name}\nEmail: ${email}\nPhone: ${phone}\nAddress: ${address}\n\nItems:\n${orderItemsList}\n\nTotal: $${total_amount.toFixed ? total_amount.toFixed(2) : total_amount}`,
            html: `<h2>Order #${orderId}</h2>
                   <p><strong>Customer:</strong> ${customer_name}</p>
                   <p><strong>Email:</strong> ${email}</p>
                   <p><strong>Phone:</strong> ${phone}</p>
                   <p><strong>Address:</strong> ${address}</p>
                   <h3>Items</h3>
                   <ul>${htmlList}</ul>
                   <p><strong>Total:</strong> $${total_amount.toFixed ? total_amount.toFixed(2) : total_amount}</p>`
        };
        if (!transporter) {
            transporter = createTransporter();
        }
        if (transporter) {
            transporter.sendMail(mailOptions).catch(err => {
                console.error('Email send failed:', err.message);
            });
        } else {
            console.log('[EMAIL NOTICE] SMTP credentials not set. Skipping email send. Payload:', mailOptions);
        }
        
        res.json({
            message: "Order placed successfully!",
            orderId: orderId
        });
    });
});

// Update Order Status
app.put('/api/orders/:id/status', adminAuth, (req, res) => {
    const { status } = req.body;
    const valid = ['Pending', 'Processing', 'Shipped', 'Completed', 'Cancelled'];
    if (!valid.includes(status)) {
        res.status(400).json({ error: 'Invalid status' });
        return;
    }
    db.run("UPDATE orders SET status = ? WHERE id = ?", [status, req.params.id], function(err) {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ message: 'Status updated', id: req.params.id, status });
    });
});

// Contact Form Submission
app.post('/api/contact', (req, res) => {
    const { name, email, message } = req.body;
    const adminEmail = 'hanzalak395@gmail.com';
    const mailOptions = {
        from: processEnv.SMTP_USER || 'no-reply@veloce.store',
        to: adminEmail,
        subject: `Contact Form: ${name}`,
        text: `Name: ${name}\nEmail: ${email}\n\nMessage:\n${message}`,
        html: `<h2>New Contact Form Submission</h2>
               <p><strong>Name:</strong> ${name}</p>
               <p><strong>Email:</strong> ${email}</p>
               <p><strong>Message:</strong></p>
               <p>${message}</p>`
        ,
        replyTo: email
    };
    if (!transporter) {
        transporter = createTransporter();
    }
    if (transporter) {
        transporter.sendMail(mailOptions).then(() => {
            res.json({ message: 'Message sent successfully' });
        }).catch(err => {
            console.error('Email send failed:', err.message);
            res.status(500).json({ error: 'Email send failed' });
        });
    } else {
        console.log('[EMAIL NOTICE] SMTP credentials not set. Contact payload:', mailOptions);
        res.json({ message: 'Message received (email not configured)' });
    }
});
// 6. Get All Orders (Admin)
app.get('/api/orders', adminAuth, (req, res) => {
    db.all("SELECT * FROM orders ORDER BY created_at DESC", [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        // Parse items JSON for frontend convenience
        const orders = rows.map(order => ({
            ...order,
            items: JSON.parse(order.items)
        }));
        res.json(orders);
    });
});

// // Static assets fallback
// app.use('/', express.static(FRONTEND_DIR));

// // Start Server
// app.listen(PORT, '0.0.0.0', () => {
//     console.log(`Server running on port ${PORT}`);
// });

// Serve uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Serve admin (protected) static files
app.use('/admin', (req, res, next) => {
  if (req.path.startsWith('/login')) return next();
  const cookies = parseCookies(req);
  const token = cookies['admin_token'];
  const payload = token ? verifyToken(token) : null;
  if (!payload || payload.email !== ADMIN_EMAIL) {
    res.redirect('/admin/login');
    return;
  }
  next();
}, express.static(path.join(FRONTEND_DIR, 'admin')));

// Serve root static files (your index.html)
app.use(express.static(FRONTEND_DIR));

// SPA fallback for frontend routes
app.get('*', (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});


