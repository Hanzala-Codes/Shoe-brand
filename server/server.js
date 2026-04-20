const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const db = require('./database');
const {
    backfillCustomersFromOrders,
    dbAll,
    dbGet,
    dbRun,
    getCustomerOrders,
    refreshCustomerCategories,
    setCustomerCategoryOverride,
    toCustomerResponse,
    upsertCustomerFromOrder
} = require('./customers');
const { getWhatsAppDiagnostics, sendOrderWhatsAppNotification } = require('./whatsapp');
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
const FRONTEND_DIR = path.join(__dirname, '..');
const ADMIN_NO_CACHE_HEADER = 'no-store, no-cache, must-revalidate, private';

function sendNoCacheFile(res, filePath) {
  res.setHeader('Cache-Control', ADMIN_NO_CACHE_HEADER);
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(filePath);
}

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
  sendNoCacheFile(res, path.join(FRONTEND_DIR, 'admin.html'));
});

app.get('/admin.js', (req, res) => {
  sendNoCacheFile(res, path.join(FRONTEND_DIR, 'admin.js'));
});

app.get('/admin.css', (req, res) => {
  sendNoCacheFile(res, path.join(FRONTEND_DIR, 'admin.css'));
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

app.get('/api/_whatsapp', (req, res) => {
  res.json(getWhatsAppDiagnostics());
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

app.get('/api/customers', adminAuth, async (req, res) => {
  try {
    await backfillCustomersFromOrders(db);
    await refreshCustomerCategories(db);

    const search = (req.query.search || '').trim();
    const category = (req.query.category || 'all').trim().toLowerCase();
    const sortBy = (req.query.sortBy || 'lastOrderDate').trim();
    const sortDir = (req.query.sortDir || 'desc').trim().toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const page = Math.max(parseInt(req.query.page || '1', 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '10', 10) || 10, 1), 100);
    const offset = (page - 1) * limit;

    const sortMap = {
      totalSpent: 'total_spent',
      totalOrders: 'total_orders',
      lastOrderDate: 'last_order_date',
      createdAt: 'created_at',
      name: 'name'
    };
    const orderColumn = sortMap[sortBy] || 'last_order_date';

    const conditions = [];
    const params = [];

    if (category && category !== 'all') {
      conditions.push('category = ?');
      params.push(category);
    }

    if (search) {
      conditions.push('(name LIKE ? OR phone LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const totalRow = await dbGet(
      db,
      `SELECT COUNT(*) AS count FROM customers ${whereClause}`,
      params
    );

    const rows = await dbAll(
      db,
      `SELECT *
       FROM customers
       ${whereClause}
       ORDER BY ${orderColumn} ${sortDir}, id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    res.json({
      items: rows.map(toCustomerResponse),
      pagination: {
        page,
        limit,
        total: totalRow ? totalRow.count : 0,
        totalPages: totalRow ? Math.max(1, Math.ceil(totalRow.count / limit)) : 1
      }
    });
  } catch (error) {
    console.error('Failed to load customers:', error.message);
    res.status(500).json({ error: 'Failed to load customers' });
  }
});

app.put('/api/customers/:id/category', adminAuth, async (req, res) => {
  try {
    const customerId = parseInt(req.params.id, 10);
    if (!Number.isFinite(customerId)) {
      res.status(400).json({ error: 'Invalid customer id' });
      return;
    }

    const updatedCustomer = await setCustomerCategoryOverride(db, customerId, req.body.category);
    if (!updatedCustomer) {
      res.status(404).json({ error: 'Customer not found' });
      return;
    }

    res.json({
      message: 'Customer category updated',
      customer: updatedCustomer
    });
  } catch (error) {
    console.error('Failed to update customer category:', error.message);
    res.status(400).json({ error: error.message || 'Failed to update customer category' });
  }
});

app.get('/api/customers/:id/orders', adminAuth, async (req, res) => {
  try {
    await backfillCustomersFromOrders(db);
    const customerId = parseInt(req.params.id, 10);
    if (!Number.isFinite(customerId)) {
      res.status(400).json({ error: 'Invalid customer id' });
      return;
    }

    const result = await getCustomerOrders(db, customerId, req.query.page, req.query.limit);
    if (!result) {
      res.status(404).json({ error: 'Customer not found' });
      return;
    }

    res.json(result);
  } catch (error) {
    console.error('Failed to load customer orders:', error.message);
    res.status(500).json({ error: 'Failed to load customer orders' });
  }
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
    const { name, category, price, description, stock, sizes, colors } = req.body;
    // If an image is uploaded, use the local path; otherwise use a placeholder or provided URL
    const imagePath = req.file ? `http://localhost:${PORT}/uploads/${req.file.filename}` : req.body.imageUrl;
    const hoverImage = req.body.hoverImage || imagePath; // Simplify for now

    const sql = "INSERT INTO products (name, category, price, image, hoverImage, description, stock, sizes, colors) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)";
    const params = [name, category, price, imagePath, hoverImage, description, stock, sizes, colors];

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
    const { name, category, price, description, stock, imageUrl, sizes, colors } = req.body;
    let imagePath = imageUrl;
    if (req.file) {
        imagePath = `http://localhost:${PORT}/uploads/${req.file.filename}`;
    }

    const sql = `UPDATE products SET name = ?, category = ?, price = ?, description = ?, stock = ?, image = ?, sizes = ?, colors = ? WHERE id = ?`;
    const params = [name, category, price, description, stock, imagePath, sizes, colors, req.params.id];

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

// 5. Place Order & Send Notifications
app.post('/api/orders', async (req, res) => {
    const { customer_name, email, phone, address, total_amount, items } = req.body;
    const normalizedItems = Array.isArray(items) ? items : [];
    const numericTotalAmount = Number(total_amount);

    if (!customer_name || !phone || !address) {
        res.status(400).json({ error: 'Customer name, phone, and address are required' });
        return;
    }

    if (!normalizedItems.length) {
        res.status(400).json({ error: 'At least one order item is required' });
        return;
    }

    if (!Number.isFinite(numericTotalAmount) || numericTotalAmount < 0) {
        res.status(400).json({ error: 'A valid total amount is required' });
        return;
    }

    const itemsJson = JSON.stringify(normalizedItems);
    const sql = "INSERT INTO orders (customer_name, email, phone, address, total_amount, items) VALUES (?, ?, ?, ?, ?, ?)";
    const params = [customer_name, email, phone, address, numericTotalAmount, itemsJson];

    let orderId = null;
    let committed = false;

    try {
        await dbRun(db, 'BEGIN IMMEDIATE TRANSACTION');

        const insertResult = await dbRun(db, sql, params);
        orderId = insertResult.lastID;

        const storedOrder = await dbGet(
            db,
            "SELECT created_at FROM orders WHERE id = ?",
            [orderId]
        );

        await upsertCustomerFromOrder(db, {
            orderId,
            customer_name,
            email,
            phone,
            total_amount: numericTotalAmount,
            orderDate: storedOrder ? storedOrder.created_at : undefined
        });

        await dbRun(db, 'COMMIT');
        committed = true;
    } catch (error) {
        if (!committed) {
            try {
                await dbRun(db, 'ROLLBACK');
            } catch (rollbackError) {
                console.error('Order rollback failed:', rollbackError.message);
            }
        }

        console.error('Failed to place order:', error.message);
        res.status(500).json({ error: 'Failed to place order' });
        return;
    }

    // Send Email to Admin
    const adminEmail = 'hanzalak395@gmail.com';
    const orderItemsList = normalizedItems.map(it => {
        const variant = (it.selectedSize || it.selectedColor) ? ` (${it.selectedSize ? 'Size: ' + it.selectedSize : ''}${it.selectedColor ? ', Color: ' + it.selectedColor : ''})` : '';
        return `${it.qty}x ${it.name}${variant} - $${(it.price * it.qty).toFixed(2)}`;
    }).join('\n');
    const htmlList = normalizedItems.map(it => {
        const variant = (it.selectedSize || it.selectedColor) ? `<br><small>${it.selectedSize ? 'Size: ' + it.selectedSize : ''}${it.selectedColor ? ', Color: ' + it.selectedColor : ''}</small>` : '';
        return `<li>${it.qty}x ${it.name}${variant} - $${(it.price * it.qty).toFixed(2)}</li>`;
    }).join('');
    const mailOptions = {
        from: processEnv.SMTP_USER || 'no-reply@veloce.store',
        to: adminEmail,
        subject: `New Order #${orderId} - ${customer_name}`,
        text: `Order #${orderId}\n\nCustomer: ${customer_name}\nEmail: ${email}\nPhone: ${phone}\nAddress: ${address}\n\nItems:\n${orderItemsList}\n\nTotal: $${numericTotalAmount.toFixed(2)}`,
        html: `<h2>Order #${orderId}</h2>
               <p><strong>Customer:</strong> ${customer_name}</p>
               <p><strong>Email:</strong> ${email}</p>
               <p><strong>Phone:</strong> ${phone}</p>
               <p><strong>Address:</strong> ${address}</p>
               <h3>Items</h3>
               <ul>${htmlList}</ul>
               <p><strong>Total:</strong> $${numericTotalAmount.toFixed(2)}</p>`
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

    sendOrderWhatsAppNotification({
        orderId,
        customer_name,
        phone,
        address,
        total_amount: numericTotalAmount,
        items: normalizedItems
    }).catch(err => {
        console.error('WhatsApp send failed:', err.message);
    });

    res.json({
        message: "Order placed successfully!",
        orderId: orderId
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

// Static assets fallback
app.use('/', express.static(FRONTEND_DIR));

// Start Server
(async () => {
    try {
        await backfillCustomersFromOrders(db);
        await refreshCustomerCategories(db);
    } catch (error) {
        console.error('Customer initialization failed:', error.message);
    }

    app.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
})();
