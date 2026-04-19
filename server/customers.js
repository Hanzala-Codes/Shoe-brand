const CUSTOMER_CATEGORIES = ['new', 'returning', 'vip', 'inactive'];

function normalizePhone(phone) {
    if (!phone) return '';
    return String(phone).trim().replace(/[^\d+]/g, '');
}

function normalizeEmail(email) {
    if (!email) return '';
    return String(email).trim().toLowerCase();
}

function normalizeName(name) {
    return name ? String(name).trim() : '';
}

function getVipThreshold() {
    const threshold = Number(process.env.CUSTOMER_VIP_THRESHOLD || 20000);
    return Number.isFinite(threshold) && threshold > 0 ? threshold : 20000;
}

function getInactiveDays() {
    const days = parseInt(process.env.CUSTOMER_INACTIVE_DAYS || '60', 10);
    return Number.isFinite(days) && days > 0 ? days : 60;
}

function getInactiveThresholdDate() {
    return new Date(Date.now() - getInactiveDays() * 24 * 60 * 60 * 1000);
}

function calculateAutomaticCategory(customer) {
    const totalOrders = Number(customer.total_orders ?? customer.totalOrders ?? 0);
    const totalSpent = Number(customer.total_spent ?? customer.totalSpent ?? 0);
    const lastOrderDate = customer.last_order_date ?? customer.lastOrderDate ?? null;

    if (lastOrderDate) {
        const parsedLastOrder = new Date(lastOrderDate);
        if (!Number.isNaN(parsedLastOrder.getTime()) && parsedLastOrder < getInactiveThresholdDate()) {
            return 'inactive';
        }
    }

    if (totalSpent >= getVipThreshold()) {
        return 'vip';
    }

    if (totalOrders >= 2) {
        return 'returning';
    }

    return 'new';
}

function toCustomerResponse(row) {
    if (!row) return null;

    return {
        id: row.id,
        name: row.name,
        phone: row.phone,
        email: row.email,
        totalOrders: Number(row.total_orders || 0),
        totalSpent: Number(row.total_spent || 0),
        lastOrderDate: row.last_order_date,
        category: row.category,
        categoryOverride: row.category_override,
        categorySource: row.category_override ? 'manual' : 'auto',
        createdAt: row.created_at
    };
}

function dbGet(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function dbAll(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function dbRun(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}

async function safeRun(db, sql, params = [], ignorableMessagePart = '') {
    try {
        return await dbRun(db, sql, params);
    } catch (error) {
        if (ignorableMessagePart && error.message && error.message.includes(ignorableMessagePart)) {
            return null;
        }
        throw error;
    }
}

async function ensureCustomerSchema(db) {
    const orderColumns = await dbAll(db, "PRAGMA table_info(orders)", []);
    const hasCustomerId = orderColumns.some(column => column.name === 'customer_id');
    if (!hasCustomerId) {
        await safeRun(db, "ALTER TABLE orders ADD COLUMN customer_id INTEGER", [], 'duplicate column name');
    }
    await safeRun(db, "CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id)", []);

    const customerColumns = await dbAll(db, "PRAGMA table_info(customers)", []);
    const hasCategoryOverride = customerColumns.some(column => column.name === 'category_override');
    const hasUpdatedAt = customerColumns.some(column => column.name === 'updated_at');

    if (!hasCategoryOverride) {
        await safeRun(db, "ALTER TABLE customers ADD COLUMN category_override TEXT", [], 'duplicate column name');
    }

    if (!hasUpdatedAt) {
        await safeRun(
            db,
            "ALTER TABLE customers ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP",
            [],
            'duplicate column name'
        );
    }
}

async function getCustomerById(db, customerId) {
    const row = await dbGet(db, "SELECT * FROM customers WHERE id = ?", [customerId]);
    return row || null;
}

async function findCustomerByContact(db, phone, email) {
    const normalizedPhone = normalizePhone(phone);
    const normalizedEmail = normalizeEmail(email);

    if (!normalizedPhone && !normalizedEmail) {
        return null;
    }

    const conditions = [];
    const params = [];

    if (normalizedPhone) {
        conditions.push("phone = ?");
        params.push(normalizedPhone);
    }

    if (normalizedEmail) {
        conditions.push("LOWER(email) = ?");
        params.push(normalizedEmail);
    }

    const orderBy = normalizedPhone ? "CASE WHEN phone = ? THEN 0 ELSE 1 END, id ASC" : "id ASC";
    if (normalizedPhone) {
        params.push(normalizedPhone);
    }

    const sql = `
        SELECT *
        FROM customers
        WHERE ${conditions.join(' OR ')}
        ORDER BY ${orderBy}
        LIMIT 1
    `;

    return dbGet(db, sql, params);
}

async function updateCustomerCategory(db, customerId) {
    const customer = await getCustomerById(db, customerId);
    if (!customer) return null;

    const automaticCategory = calculateAutomaticCategory(customer);
    const effectiveCategory = customer.category_override || automaticCategory;

    if (customer.category !== effectiveCategory) {
        await dbRun(
            db,
            "UPDATE customers SET category = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            [effectiveCategory, customerId]
        );
    }

    const refreshed = await getCustomerById(db, customerId);
    return toCustomerResponse(refreshed);
}

async function refreshCustomerCategories(db) {
    const rows = await dbAll(db, "SELECT * FROM customers", []);
    for (const row of rows) {
        const automaticCategory = calculateAutomaticCategory(row);
        const effectiveCategory = row.category_override || automaticCategory;
        if (row.category !== effectiveCategory) {
            await dbRun(
                db,
                "UPDATE customers SET category = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                [effectiveCategory, row.id]
            );
        }
    }
}

async function upsertCustomerFromOrder(db, order) {
    await ensureCustomerSchema(db);

    let persistedOrder = null;
    if (order.orderId) {
        persistedOrder = await dbGet(
            db,
            "SELECT id, customer_id, created_at FROM orders WHERE id = ?",
            [order.orderId]
        );

        if (persistedOrder && persistedOrder.customer_id) {
            const linkedCustomer = await getCustomerById(db, persistedOrder.customer_id);
            if (linkedCustomer) {
                return updateCustomerCategory(db, linkedCustomer.id);
            }
        }
    }

    const phone = normalizePhone(order.phone);
    const email = normalizeEmail(order.email);
    const name = normalizeName(order.customer_name || order.name);
    const totalAmount = Number(order.total_amount);
    const safeTotalAmount = Number.isFinite(totalAmount) ? totalAmount : 0;
    const orderDate = order.orderDate || (persistedOrder && persistedOrder.created_at) || new Date().toISOString();

    if (!phone) {
        throw new Error('Customer phone is required for customer synchronization');
    }

    const existingCustomer = await findCustomerByContact(db, phone, email);

    if (!existingCustomer) {
        const automaticCategory = calculateAutomaticCategory({
            total_orders: 1,
            total_spent: safeTotalAmount,
            last_order_date: orderDate
        });

        const insertResult = await dbRun(
            db,
            `INSERT INTO customers (
                name,
                phone,
                email,
                total_orders,
                total_spent,
                last_order_date,
                category
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [name || 'Guest Customer', phone, email || null, 1, safeTotalAmount, orderDate, automaticCategory]
        );

        if (order.orderId) {
            await dbRun(db, "UPDATE orders SET customer_id = ? WHERE id = ?", [insertResult.lastID, order.orderId]);
        }

        return updateCustomerCategory(db, insertResult.lastID);
    }

    let nextPhone = existingCustomer.phone;
    if (phone && phone !== existingCustomer.phone) {
        const conflictingPhoneOwner = await dbGet(
            db,
            "SELECT id FROM customers WHERE phone = ? AND id <> ?",
            [phone, existingCustomer.id]
        );
        if (!conflictingPhoneOwner) {
            nextPhone = phone;
        }
    }

    const nextTotalOrders = Number(existingCustomer.total_orders || 0) + 1;
    const nextTotalSpent = Number(existingCustomer.total_spent || 0) + safeTotalAmount;
    const automaticCategory = calculateAutomaticCategory({
        total_orders: nextTotalOrders,
        total_spent: nextTotalSpent,
        last_order_date: orderDate
    });
    const effectiveCategory = existingCustomer.category_override || automaticCategory;

    await dbRun(
        db,
        `UPDATE customers
         SET name = ?,
             phone = ?,
             email = ?,
             total_orders = ?,
             total_spent = ?,
             last_order_date = ?,
             category = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
            name || existingCustomer.name || 'Guest Customer',
            nextPhone,
            email || existingCustomer.email || null,
            nextTotalOrders,
            nextTotalSpent,
            orderDate,
            effectiveCategory,
            existingCustomer.id
        ]
    );

    if (order.orderId) {
        await dbRun(db, "UPDATE orders SET customer_id = ? WHERE id = ?", [existingCustomer.id, order.orderId]);
    }

    return updateCustomerCategory(db, existingCustomer.id);
}

async function setCustomerCategoryOverride(db, customerId, overrideValue) {
    const customer = await getCustomerById(db, customerId);
    if (!customer) {
        return null;
    }

    let normalizedOverride = null;
    if (overrideValue && overrideValue !== 'auto') {
        const candidate = String(overrideValue).trim().toLowerCase();
        if (!CUSTOMER_CATEGORIES.includes(candidate)) {
            throw new Error('Invalid customer category');
        }
        normalizedOverride = candidate;
    }

    const automaticCategory = calculateAutomaticCategory(customer);
    const effectiveCategory = normalizedOverride || automaticCategory;

    await dbRun(
        db,
        `UPDATE customers
         SET category_override = ?,
             category = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [normalizedOverride, effectiveCategory, customerId]
    );

    return updateCustomerCategory(db, customerId);
}

async function backfillCustomersFromOrders(db) {
    await ensureCustomerSchema(db);

    const historicalOrders = await dbAll(
        db,
        `SELECT id, customer_name, email, phone, total_amount, created_at
         FROM orders
         WHERE customer_id IS NULL
         ORDER BY datetime(created_at) ASC, id ASC`,
        []
    );

    for (const order of historicalOrders) {
        try {
            await upsertCustomerFromOrder(db, {
                orderId: order.id,
                customer_name: order.customer_name,
                email: order.email,
                phone: order.phone,
                total_amount: order.total_amount,
                orderDate: order.created_at
            });
        } catch (error) {
            console.error(`Failed to backfill customer for order #${order.id}:`, error.message);
        }
    }
}

async function getCustomerOrders(db, customerId, page = 1, limit = 10) {
    const customer = await getCustomerById(db, customerId);
    if (!customer) return null;

    const safePage = Number.isFinite(Number(page)) && Number(page) > 0 ? Number(page) : 1;
    const safeLimit = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.min(Number(limit), 100) : 10;
    const offset = (safePage - 1) * safeLimit;
    const normalizedEmail = normalizeEmail(customer.email);

    const countRow = await dbGet(
        db,
        `SELECT COUNT(*) AS count
         FROM orders
         WHERE customer_id = ?
            OR (customer_id IS NULL AND phone = ?)
            OR (customer_id IS NULL AND ? <> '' AND LOWER(email) = ?)`,
        [customerId, customer.phone, normalizedEmail, normalizedEmail]
    );

    const rows = await dbAll(
        db,
        `SELECT *
         FROM orders
         WHERE customer_id = ?
            OR (customer_id IS NULL AND phone = ?)
            OR (customer_id IS NULL AND ? <> '' AND LOWER(email) = ?)
         ORDER BY datetime(created_at) DESC, id DESC
         LIMIT ? OFFSET ?`,
        [customerId, customer.phone, normalizedEmail, normalizedEmail, safeLimit, offset]
    );

    return {
        customer: toCustomerResponse(customer),
        pagination: {
            page: safePage,
            limit: safeLimit,
            total: countRow ? countRow.count : 0,
            totalPages: countRow ? Math.max(1, Math.ceil(countRow.count / safeLimit)) : 1
        },
        orders: rows.map(order => ({
            ...order,
            items: JSON.parse(order.items)
        }))
    };
}

module.exports = {
    CUSTOMER_CATEGORIES,
    backfillCustomersFromOrders,
    calculateAutomaticCategory,
    dbAll,
    dbGet,
    dbRun,
    ensureCustomerSchema,
    findCustomerByContact,
    getCustomerById,
    getCustomerOrders,
    normalizeEmail,
    normalizePhone,
    refreshCustomerCategories,
    setCustomerCategoryOverride,
    toCustomerResponse,
    upsertCustomerFromOrder
};
