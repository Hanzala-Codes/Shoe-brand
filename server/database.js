const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'ecommerce.db');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database ' + dbPath + ': ' + err.message);
    } else {
        console.log('Connected to the SQLite database.');
    }
});

db.serialize(() => {
    // Create Products Table
    db.run(`CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        price REAL NOT NULL,
        image TEXT,
        hoverImage TEXT,
        description TEXT,
        stock INTEGER DEFAULT 100,
        sizes TEXT, -- JSON array of sizes
        colors TEXT, -- JSON array of colors
        best_seller INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Ensure sizes and colors columns exist
    db.all("PRAGMA table_info(products)", (err, rows) => {
        if (!err) {
            const hasSizes = rows.some(r => r.name === 'sizes');
            const hasColors = rows.some(r => r.name === 'colors');
            
            if (!hasSizes) {
                db.run("ALTER TABLE products ADD COLUMN sizes TEXT");
            }
            if (!hasColors) {
                db.run("ALTER TABLE products ADD COLUMN colors TEXT");
            }
        }
    });

    // Create Orders Table
    db.run(`CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_name TEXT NOT NULL,
        email TEXT,
        phone TEXT NOT NULL,
        address TEXT NOT NULL,
        total_amount REAL NOT NULL,
        items TEXT NOT NULL, -- JSON string of items
        customer_id INTEGER,
        status TEXT DEFAULT 'Pending',
        best_seller INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Create Customers Table
    db.run(`CREATE TABLE IF NOT EXISTS customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT NOT NULL UNIQUE,
        email TEXT,
        total_orders INTEGER DEFAULT 0,
        total_spent REAL DEFAULT 0,
        last_order_date DATETIME,
        category TEXT NOT NULL DEFAULT 'new',
        category_override TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run("CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(phone)");
    db.run("CREATE INDEX IF NOT EXISTS idx_orders_email ON orders(email)");
    db.run("CREATE INDEX IF NOT EXISTS idx_customers_category ON customers(category)");
    db.run("CREATE INDEX IF NOT EXISTS idx_customers_last_order_date ON customers(last_order_date)");
    db.run("CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email)");
    
    // Ensure best_seller column exists and has some data
    db.all("PRAGMA table_info(products)", (err, rows) => {
        if (!err) {
            const hasBest = rows.some(r => r.name === 'best_seller');
            if (!hasBest) {
                db.run("ALTER TABLE products ADD COLUMN best_seller INTEGER DEFAULT 0", [], function(alterErr) {
                    if (alterErr) {
                        console.error('Failed to add best_seller column:', alterErr.message);
                    } else {
                        markInitialBestSellers();
                    }
                });
            } else {
                // If column exists, check if we have any best sellers, if not, mark some
                db.get("SELECT COUNT(*) as count FROM products WHERE best_seller = 1", (countErr, row) => {
                    if (!countErr && row.count === 0) {
                        markInitialBestSellers();
                    }
                });
            }
        }
    });

    function markInitialBestSellers() {
        db.run("UPDATE products SET best_seller = 1 WHERE name IN ('Urban Runner','Oxford Classic','Velvet Ease', 'Golden Hour')", [], function(updateErr) {
            if (updateErr) {
                console.error('Failed to mark best sellers:', updateErr.message);
            } else {
                console.log('Successfully marked initial best sellers');
            }
        });
    }

    db.all("PRAGMA table_info(orders)", (err, rows) => {
        if (!err) {
            const hasCustomerId = rows.some(r => r.name === 'customer_id');
            if (!hasCustomerId) {
                db.run("ALTER TABLE orders ADD COLUMN customer_id INTEGER", [], function(alterErr) {
                    if (alterErr) {
                        console.error('Failed to add customer_id column to orders:', alterErr.message);
                    } else {
                        db.run("CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id)");
                    }
                });
            } else {
                db.run("CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id)");
            }
        }
    });

    db.all("PRAGMA table_info(customers)", (err, rows) => {
        if (!err) {
            const hasCategoryOverride = rows.some(r => r.name === 'category_override');
            const hasUpdatedAt = rows.some(r => r.name === 'updated_at');

            if (!hasCategoryOverride) {
                db.run("ALTER TABLE customers ADD COLUMN category_override TEXT", [], function(alterErr) {
                    if (alterErr) {
                        console.error('Failed to add category_override column to customers:', alterErr.message);
                    }
                });
            }

            if (!hasUpdatedAt) {
                db.run("ALTER TABLE customers ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP", [], function(alterErr) {
                    if (alterErr) {
                        console.error('Failed to add updated_at column to customers:', alterErr.message);
                    }
                });
            }
        }
    });

    // Seed initial data if empty (optional, but good for demo)
    db.get("SELECT count(*) as count FROM products", (err, row) => {
        if (row.count === 0) {
            console.log("Seeding initial products...");
            const initialProducts = [
                // Sandals
                { name: "Velvet Ease", category: "Sandals", price: 180, image: "https://images.unsplash.com/photo-1543163521-1bf539c55dd2?q=80&w=800&auto=format&fit=crop", hoverImage: "https://images.unsplash.com/photo-1543163521-1bf539c55dd2?q=80&w=800&auto=format&fit=crop", best_seller: 1 },
                { name: "Summer Breeze", category: "Sandals", price: 150, image: "https://images.unsplash.com/photo-1562273138-f46be4ebdf6c?q=80&w=800&auto=format&fit=crop", hoverImage: "https://images.unsplash.com/photo-1562273138-f46be4ebdf6c?q=80&w=800&auto=format&fit=crop" },
                { name: "Golden Hour", category: "Sandals", price: 220, image: "https://images.unsplash.com/photo-1535043934128-cf0b28d52f95?q=80&w=800&auto=format&fit=crop", hoverImage: "https://images.unsplash.com/photo-1535043934128-cf0b28d52f95?q=80&w=800&auto=format&fit=crop" },
                
                // Slippers
                { name: "Cozy Night", category: "Slippers", price: 90, image: "https://images.unsplash.com/photo-1516478177764-9fe5bd7e9717?q=80&w=800&auto=format&fit=crop", hoverImage: "https://images.unsplash.com/photo-1516478177764-9fe5bd7e9717?q=80&w=800&auto=format&fit=crop" },
                { name: "Luxe Slide", category: "Slippers", price: 120, image: "https://images.unsplash.com/photo-1560769619-37e7745814e5?q=80&w=800&auto=format&fit=crop", hoverImage: "https://images.unsplash.com/photo-1560769619-37e7745814e5?q=80&w=800&auto=format&fit=crop" },
                { name: "Home Comfort", category: "Slippers", price: 85, image: "https://images.unsplash.com/photo-1595341888016-a392ef81b7de?q=80&w=800&auto=format&fit=crop", hoverImage: "https://images.unsplash.com/photo-1595341888016-a392ef81b7de?q=80&w=800&auto=format&fit=crop" },

                // Sneakers
                { name: "Urban Runner", category: "Sneakers", price: 250, image: "https://images.unsplash.com/photo-1560769629-975e127dfc17?q=80&w=800&auto=format&fit=crop", hoverImage: "https://images.unsplash.com/photo-1560769629-975e127dfc17?q=80&w=800&auto=format&fit=crop", best_seller: 1 },
                { name: "Street King", category: "Sneakers", price: 280, image: "https://images.unsplash.com/photo-1549298916-b41d501d3772?q=80&w=800&auto=format&fit=crop", hoverImage: "https://images.unsplash.com/photo-1549298916-b41d501d3772?q=80&w=800&auto=format&fit=crop" },
                { name: "Retro High", category: "Sneakers", price: 280, image: "https://images.unsplash.com/photo-1607522370275-f14bc3a5d288?q=80&w=800&auto=format&fit=crop", hoverImage: "https://images.unsplash.com/photo-1595950653106-6c9ebd614d3a?q=80&w=800&auto=format&fit=crop" },

                // Formal
                { name: "Oxford Classic", category: "Formal", price: 350, image: "https://images.unsplash.com/photo-1614252369475-531eba835eb1?q=80&w=800&auto=format&fit=crop", hoverImage: "https://images.unsplash.com/photo-1614252369475-531eba835eb1?q=80&w=800&auto=format&fit=crop", best_seller: 1 },
                { name: "Derby Elite", category: "Formal", price: 320, image: "https://images.unsplash.com/photo-1478146896981-b80c463e4381?q=80&w=800&auto=format&fit=crop", hoverImage: "https://images.unsplash.com/photo-1478146896981-b80c463e4381?q=80&w=800&auto=format&fit=crop" },
                { name: "Monk Strap Pro", category: "Formal", price: 380, image: "https://images.unsplash.com/photo-1449505278894-297fdb3edbc1?q=80&w=800&auto=format&fit=crop", hoverImage: "https://images.unsplash.com/photo-1560343090-f0409e92791a?q=80&w=800&auto=format&fit=crop" }
            ];

            const stmt = db.prepare("INSERT INTO products (name, category, price, image, hoverImage, best_seller) VALUES (?, ?, ?, ?, ?, ?)");
            initialProducts.forEach(product => {
                stmt.run(product.name, product.category, product.price, product.image, product.hoverImage, product.best_seller ? 1 : 0);
            });
            stmt.finalize();
        }
    });
});

module.exports = db;
