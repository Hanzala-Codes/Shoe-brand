/* =============== DATA =============== */
let products = [];
const API_URL = '/api';
const productGrid = document.getElementById('product-grid');
const pageCategory = document.body.getAttribute('data-page');

async function fetchProducts() {
    try {
        // Add timestamp to prevent caching
        const response = await fetch(`${API_URL}/products?t=${Date.now()}`);
        if (!response.ok) throw new Error('Failed to fetch products');
        products = await response.json();
        console.log('Fetched products with variants:', products.map(p => ({ name: p.name, sizes: p.sizes, colors: p.colors })));
        renderProducts();
    } catch (error) {
        console.error('Error fetching products:', error);
        if (productGrid) {
            productGrid.innerHTML = `<p class="center-text">Failed to load products. Please try again later.</p>`;
        }
    }
}

// Fetch products on load
fetchProducts();

/* =============== CART CLASS =============== */
class ShoppingCart {
    constructor() {
        this.cart = JSON.parse(localStorage.getItem('veloce_cart')) || [];
        this.cartContent = document.getElementById('cart-content');
        this.cartCount = document.getElementById('cart-count');
        this.cartTotal = document.getElementById('cart-total-price');
        this.checkoutTotal = document.getElementById('checkout-total');
        this.init();
    }

    init() {
        // Migration: Ensure all cart items have a variantId for proper removal/update
        let updated = false;
        this.cart = this.cart.map(item => {
            if (!item.variantId) {
                const size = item.selectedSize || 'Standard';
                const color = item.selectedColor || 'Default';
                item.variantId = `${item.id}-${size}-${color}`;
                item.selectedSize = size;
                item.selectedColor = color;
                updated = true;
            }
            return item;
        });
        
        if (updated) this.save();
        
        this.renderCart();
        this.updateCount();
    }

    add(productId, size = null, color = null) {
        // Use == for flexible ID comparison
        const product = products.find(p => p.id == productId);
        if (!product) return;

        // If product has sizes or colors but they aren't selected, we need to show selection UI
        // However, the current requirement is to select from product card.
        // For simplicity, we'll assume the caller passes size/color or we show a prompt.
        
        if (!size || !color) {
            this.openQuickView(product.id);
            return;
        }

        const variantId = `${productId}-${size}-${color}`;
        const existingItem = this.cart.find(item => item.variantId === variantId);
        
        if (existingItem) {
            existingItem.qty++;
        } else {
            this.cart.push({ 
                ...product, 
                variantId,
                selectedSize: size, 
                selectedColor: color,
                qty: 1 
            });
        }

        this.save();
        this.renderCart();
        this.updateCount();
        this.showFeedback();
        
        // Close modal if open
        const modal = document.getElementById('quick-view-modal');
        if (modal) modal.classList.remove('open');
    }

    remove(variantId) {
        this.cart = this.cart.filter(item => item.variantId !== variantId);
        this.save();
        this.renderCart();
        this.updateCount();
    }

    updateQty(variantId, change) {
        // variantId is a string like "1-42-Black", so strict comparison is fine
        const item = this.cart.find(item => item.variantId === variantId);
        if (!item) return;

        item.qty += change;
        if (item.qty <= 0) {
            this.remove(variantId);
        } else {
            this.save();
            this.renderCart();
            this.updateCount();
        }
    }

    openQuickView(productId) {
        // Ensure products are loaded
        if (!products || products.length === 0) {
            console.warn('Products not loaded yet');
            return;
        }

        // Use == to allow string/number comparison for ID
        const product = products.find(p => p.id == productId);
        if (!product) {
            console.error('Product not found:', productId);
            return;
        }

        let quickViewModal = document.getElementById('quick-view-modal');
        if (!quickViewModal) {
            quickViewModal = document.createElement('div');
            quickViewModal.id = 'quick-view-modal';
            quickViewModal.className = 'modal';
            document.body.appendChild(quickViewModal);
        }

        // Helper to safely parse sizes/colors which might be strings or arrays
        const parseVariant = (data) => {
            if (!data) return [];
            if (Array.isArray(data)) return data;
            try {
                const parsed = JSON.parse(data);
                return Array.isArray(parsed) ? parsed : [];
            } catch (e) {
                // If it's a comma-separated string instead of JSON
                if (typeof data === 'string' && data.includes(',')) {
                    return data.split(',').map(s => s.trim());
                }
                return data ? [data] : [];
            }
        };

        const sizes = parseVariant(product.sizes);
        const colors = parseVariant(product.colors);

        console.log(`Displaying variants for ${product.name}:`, { sizes, colors });

        quickViewModal.innerHTML = `
            <div class="modal__content quick-view">
                <i class="ri-close-line modal__close" onclick="document.getElementById('quick-view-modal').classList.remove('open')"></i>
                <div class="quick-view__grid">
                    <div class="quick-view__image">
                        <img src="${product.image}" alt="${product.name}">
                    </div>
                    <div class="quick-view__info">
                        <h2 class="quick-view__title">${product.name}</h2>
                        <span class="quick-view__price">$${product.price}</span>
                        <p class="quick-view__description">${product.description || 'Luxury handcrafted footwear.'}</p>
                        
                        <div class="variant-selection">
                            ${sizes.length > 0 ? `
                            <div class="variant-group">
                                <span class="variant-label">Select Size</span>
                                <div class="variant-options size-options">
                                    ${sizes.map(s => `
                                        <button class="variant-btn size-btn" data-size="${s}">${s}</button>
                                    `).join('')}
                                </div>
                            </div>
                            ` : ''}
                            
                            ${colors.length > 0 ? `
                            <div class="variant-group">
                                <span class="variant-label">Select Color</span>
                                <div class="variant-options color-options">
                                    ${colors.map(c => `
                                        <button class="variant-btn color-btn" data-color="${c}">${c}</button>
                                    `).join('')}
                                </div>
                            </div>
                            ` : ''}

                            ${sizes.length === 0 && colors.length === 0 ? `
                                <p style="margin-bottom: 2rem; color: var(--text-color-light);">This product is currently only available in standard options.</p>
                            ` : ''}
                        </div>

                        <div id="variant-error" class="error-message" style="display:none; color: #ff4d4d; margin-bottom: 1rem; font-size: 0.9rem;">
                            Please select ${sizes.length > 0 ? 'size' : ''} ${sizes.length > 0 && colors.length > 0 ? 'and' : ''} ${colors.length > 0 ? 'color' : ''}
                        </div>

                        <button class="button quick-view__add-btn" id="quick-add-btn">
                            Add to Bag
                        </button>
                    </div>
                </div>
            </div>
        `;

        // Wait a bit for the DOM to update before showing
        setTimeout(() => quickViewModal.classList.add('open'), 10);

        // Setup Selection Logic
        let selectedSize = sizes.length === 0 ? 'Standard' : null;
        let selectedColor = colors.length === 0 ? 'Default' : null;

        const sizeBtns = quickViewModal.querySelectorAll('.size-btn');
        const colorBtns = quickViewModal.querySelectorAll('.color-btn');
        const errorMsg = quickViewModal.querySelector('#variant-error');

        sizeBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                sizeBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                selectedSize = btn.dataset.size;
                errorMsg.style.display = 'none';
            });
        });

        colorBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                colorBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                selectedColor = btn.dataset.color;
                errorMsg.style.display = 'none';
            });
        });

        quickViewModal.querySelector('#quick-add-btn').addEventListener('click', () => {
            if (!selectedSize || !selectedColor) {
                errorMsg.style.display = 'block';
                return;
            }
            this.add(product.id, selectedSize, selectedColor);
        });
    }

    clear() {
        this.cart = [];
        this.save();
        this.renderCart();
        this.updateCount();
    }

    save() {
        localStorage.setItem('veloce_cart', JSON.stringify(this.cart));
    }

    updateCount() {
        const count = this.cart.reduce((acc, item) => acc + item.qty, 0);
        this.cartCount.textContent = count;
        
        // Animate badge
        if(count > 0) {
            this.cartCount.classList.add('bump');
            setTimeout(() => this.cartCount.classList.remove('bump'), 300);
        }
    }

    calculateTotal() {
        return this.cart.reduce((acc, item) => acc + (item.price * item.qty), 0);
    }

    renderCart() {
        const total = this.calculateTotal();
        if (this.cartTotal) this.cartTotal.textContent = `$${total.toFixed(2)}`;
        if (this.checkoutTotal) this.checkoutTotal.textContent = `$${total.toFixed(2)}`;

        if (!this.cartContent) return;
        if (this.cart.length === 0) {
            this.cartContent.innerHTML = `
                <div class="cart__empty">
                    <p>Your bag is empty.</p>
                    <button class="button button--ghost" onclick="closeCart()">Start Shopping</button>
                </div>
            `;
            return;
        }

        this.cartContent.innerHTML = this.cart.map(item => {
            // Escape single quotes for the inline JS onclick handler
            const safeVariantId = String(item.variantId).replace(/'/g, "\\'");
            
            return `
            <div class="cart__item">
                <img src="${item.image}" alt="${item.name}" class="cart__img">
                <div class="cart__item-info">
                    <h4>${item.name}</h4>
                    <span class="cart__item-variant">Size: ${item.selectedSize} | Color: ${item.selectedColor}</span>
                    <span class="cart__item-price">$${item.price.toFixed(2)}</span>
                    <div class="cart__item-actions">
                        <button class="cart__qty-btn" onclick="cart.updateQty('${safeVariantId}', -1)">-</button>
                        <span>${item.qty}</span>
                        <button class="cart__qty-btn" onclick="cart.updateQty('${safeVariantId}', 1)">+</button>
                    </div>
                </div>
                <div class="cart__remove" onclick="cart.remove('${safeVariantId}')">
                    <i class="ri-delete-bin-line"></i>
                </div>
            </div>
        `;}).join('');
    }

    showFeedback() {
        // Simple toast or feedback logic could go here
        const cartBtn = document.getElementById('cart-btn');
        cartBtn.style.transform = 'scale(1.2)';
        setTimeout(() => cartBtn.style.transform = 'scale(1)', 200);
    }
}

const cart = new ShoppingCart();

// Helper to close cart from inline HTML
window.closeCart = () => {
    document.getElementById('cart-sidebar').classList.remove('open');
    document.getElementById('cart-overlay').classList.remove('open');
};

// Expose cart to window for inline onclick handlers
window.cart = cart;


/* =============== RENDER PRODUCTS =============== */
let activeFilters = {
    sort: 'all',
    category: 'all',
    price: 'all'
};

function getFilteredProducts() {
    let filtered = [...products];
    
    // 1. Initial Category Filter (from page data-page)
    if (pageCategory) {
        const categoryMap = {
            'sandals': 'Sandals',
            'slippers': 'Slippers',
            'sneakers': 'Sneakers',
            'formal': 'Formal',
            'new-arrivals': 'NEW_ARRIVALS',
            'best-sellers': 'BEST_SELLERS'
        };
        const targetCategory = categoryMap[pageCategory];
        
        if (targetCategory && targetCategory !== 'NEW_ARRIVALS' && targetCategory !== 'BEST_SELLERS') {
            filtered = filtered.filter(p => p.category === targetCategory);
        } else if (targetCategory === 'NEW_ARRIVALS') {
            filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        } else if (targetCategory === 'BEST_SELLERS') {
            const bestSellers = filtered.filter(p => p.best_seller === 1 || p.best_seller === true);
            
            if (bestSellers.length > 0) {
                filtered = bestSellers;
            } else {
                // Fallback: If no products marked as best sellers, show top 4 most expensive as "premium" best sellers
                console.log('No best sellers marked, using price fallback');
                filtered = [...filtered].sort((a, b) => b.price - a.price).slice(0, 4);
            }
        }
    }

    // 2. Category Filter (from UI) - mainly for Home page
    if (activeFilters.category !== 'all') {
        filtered = filtered.filter(p => p.category === activeFilters.category);
    }

    // 3. Price Filter
    if (activeFilters.price !== 'all') {
        if (activeFilters.price === '0-100') {
            filtered = filtered.filter(p => p.price < 100);
        } else if (activeFilters.price === '100-200') {
            filtered = filtered.filter(p => p.price >= 100 && p.price <= 200);
        } else if (activeFilters.price === '200-above') {
            filtered = filtered.filter(p => p.price > 200);
        }
    }

    // 4. Sort Filter
    if (activeFilters.sort === 'price-low') {
        filtered.sort((a, b) => a.price - b.price);
    } else if (activeFilters.sort === 'price-high') {
        filtered.sort((a, b) => b.price - a.price);
    } else if (activeFilters.sort === 'newest') {
        filtered.sort((a, b) => b.id - a.id);
    }

    return filtered;
}

function renderProducts(productsToRender = getFilteredProducts()) {
    if (!productGrid) return;
    
    if (productsToRender.length === 0) {
        const message = pageCategory === 'best-sellers' 
            ? 'No best-selling products available yet.' 
            : 'No products found matching your selection.';
            
        productGrid.innerHTML = `
            <div class="center-text" style="grid-column: 1/-1; padding: 4rem 0;">
                <p>${message}</p>
                <button class="button button--small" style="margin-top: 1rem" onclick="resetFilters()">Clear Filters</button>
            </div>
        `;
        return;
    }

    productGrid.innerHTML = productsToRender.map(product => {
        // Find the actual product object from the products array to ensure we have size/color data
        const productData = products.find(p => p.id === product.id) || product;
        return `
        <article class="product-card">
            <div class="product__img-box">
                <img src="${productData.image}" alt="${productData.name}" class="product__img">
                <div class="product__actions">
                    <button class="add-to-cart-btn" onclick="cart.openQuickView(${productData.id})">
                        Quick Add - $${productData.price}
                    </button>
                </div>
            </div>
            <div class="product__info">
                <div>
                    <h3 class="product__title">${productData.name}</h3>
                    <span class="product__category">${productData.category}</span>
                </div>
                <span class="product__price">$${productData.price}</span>
            </div>
        </article>
    `;}).join('');
    
    // Re-trigger animations
    if(window.observer) {
        document.querySelectorAll('.product-card').forEach(el => {
            el.style.opacity = '0';
            el.style.transform = 'translateY(30px)';
            window.observer.observe(el);
        });
    }
}

// Filter Buttons Logic
function initFilters() {
    const filterGroups = document.querySelectorAll('.filter__group');
    
    filterGroups.forEach(group => {
        const btns = group.querySelectorAll('.filter-btn');
        
        btns.forEach(btn => {
            btn.addEventListener('click', () => {
                // Update UI: remove active from siblings
                btns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                
                // Update state
                if (btn.dataset.sort) activeFilters.sort = btn.dataset.sort;
                if (btn.dataset.category) activeFilters.category = btn.dataset.category;
                if (btn.dataset.price) activeFilters.price = btn.dataset.price;
                
                // Render
                renderProducts();
            });
        });
    });
}

function resetFilters() {
    activeFilters = { sort: 'all', category: 'all', price: 'all' };
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.sort === 'all' || btn.dataset.category === 'all' || btn.dataset.price === 'all') {
            btn.classList.add('active');
        }
    });
    renderProducts();
}

window.resetFilters = resetFilters;

// Initial Call
 initFilters();



/* =============== UI INTERACTIONS =============== */
// Mobile Menu
const navMenu = document.getElementById('nav-menu'),
      navToggle = document.getElementById('nav-toggle'),
      navClose = document.getElementById('nav-close');

if(navToggle) navToggle.addEventListener('click', () => navMenu.classList.add('show-menu'));
if(navClose) navClose.addEventListener('click', () => navMenu.classList.remove('show-menu'));

// Close mobile menu on link click
const navLink = document.querySelectorAll('.nav__link');
navLink.forEach(n => n.addEventListener('click', () => navMenu.classList.remove('show-menu')));

// Scroll Header
window.addEventListener('scroll', () => {
    const header = document.getElementById('header');
    if(window.scrollY >= 50) header.classList.add('scroll-header');
    else header.classList.remove('scroll-header');
});

// Cart Sidebar Toggle
const cartBtn = document.getElementById('cart-btn'),
      cartSidebar = document.getElementById('cart-sidebar'),
      cartOverlay = document.getElementById('cart-overlay'),
      cartClose = document.getElementById('cart-close');

function toggleCart() {
    if (!cartSidebar || !cartOverlay) return;
    cartSidebar.classList.toggle('open');
    cartOverlay.classList.toggle('open');
    document.body.classList.toggle('no-scroll'); // Prevent background scrolling
}

if(cartBtn) cartBtn.addEventListener('click', toggleCart);
if(cartClose) cartClose.addEventListener('click', toggleCart);
if(cartOverlay) cartOverlay.addEventListener('click', toggleCart);

function initFaqAccordion() {
    const faqItems = document.querySelectorAll('.faq-accordion__item');
    if (!faqItems.length) return;

    faqItems.forEach((item, index) => {
        const trigger = item.querySelector('.faq-accordion__trigger');
        const panel = item.querySelector('.faq-accordion__panel');
        if (!trigger || !panel) return;

        const panelId = `faq-panel-${index + 1}`;
        trigger.setAttribute('aria-controls', panelId);
        panel.id = panelId;

        const setExpandedState = (expanded) => {
            item.classList.toggle('active', expanded);
            trigger.setAttribute('aria-expanded', expanded ? 'true' : 'false');
            panel.style.maxHeight = expanded ? `${panel.scrollHeight}px` : '0px';
        };

        setExpandedState(item.classList.contains('active'));

        trigger.addEventListener('click', () => {
            const isExpanded = item.classList.contains('active');

            faqItems.forEach(otherItem => {
                const otherTrigger = otherItem.querySelector('.faq-accordion__trigger');
                const otherPanel = otherItem.querySelector('.faq-accordion__panel');
                if (!otherTrigger || !otherPanel) return;

                otherItem.classList.remove('active');
                otherTrigger.setAttribute('aria-expanded', 'false');
                otherPanel.style.maxHeight = '0px';
            });

            if (!isExpanded) {
                setExpandedState(true);
            }
        });
    });
}

initFaqAccordion();

/* =============== CHECKOUT LOGIC =============== */
const checkoutBtn = document.getElementById('checkout-btn'),
      checkoutModal = document.getElementById('checkout-modal'),
      checkoutClose = document.getElementById('checkout-close'),
      checkoutForm = document.getElementById('checkout-form'),
      successOverlay = document.getElementById('success-overlay'),
      successClose = document.getElementById('success-close');

// Open Checkout
if(checkoutBtn) {
    checkoutBtn.addEventListener('click', () => {
        if (cart.cart.length === 0) {
            alert("Your bag is empty!");
            return;
        }
        toggleCart(); // Close sidebar
        checkoutModal.classList.add('open');
    });
}

// Close Checkout
if(checkoutClose) {
    checkoutClose.addEventListener('click', () => {
        checkoutModal.classList.remove('open');
    });
}

// Payment Method Toggle (Simplified for COD Only)
const paymentOptions = document.querySelectorAll('.payment__option');
// Card details removed, only COD logic remains


// Handle Form Submission
if(checkoutForm) {
    checkoutForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const btn = checkoutForm.querySelector('button[type="submit"]');
        const originalText = btn.textContent;
        btn.textContent = 'Processing...';
        btn.disabled = true;

        // Gather Data
        const formData = {
            customer_name: document.getElementById('name').value,
            email: document.getElementById('email').value,
            phone: document.getElementById('phone').value,
            address: document.getElementById('address').value,
            total_amount: cart.calculateTotal(),
            items: cart.cart
        };

        try {
            const response = await fetch(`${API_URL}/orders`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });

            if (!response.ok) throw new Error('Order failed');

            const result = await response.json();
            
            // Success
            checkoutModal.classList.remove('open');
            successOverlay.classList.add('active');
            cart.clear();
            checkoutForm.reset();
        } catch (error) {
            console.error(error);
            alert('There was an error placing your order. Please try again.');
        } finally {
            btn.textContent = originalText;
            btn.disabled = false;
        }
    });
}

// Contact Form Submission
const contactForm = document.getElementById('contact-form');
if (contactForm) {
    contactForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = contactForm.querySelector('button[type=\"submit\"]');
        const originalText = btn.textContent;
        btn.textContent = 'Sending...';
        btn.disabled = true;
        try {
            const payload = {
                name: document.getElementById('contact-name').value,
                email: document.getElementById('contact-email').value,
                message: document.getElementById('contact-message').value
            };
            const response = await fetch(`${API_URL}/contact`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!response.ok) throw new Error('Failed to send message');
            alert('Message sent successfully.');
            contactForm.reset();
        } catch (err) {
            console.error(err);
            alert('Failed to send message. Please try again later.');
        } finally {
            btn.textContent = originalText;
            btn.disabled = false;
        }
    });
}

if(successClose) {
    successClose.addEventListener('click', () => {
        successOverlay.classList.remove('active');
    });
}

/* =============== THEME LOGIC =============== */
const themeButton = document.getElementById('theme-button');
const darkTheme = 'dark-theme';
const iconTheme = 'ri-sun-line';

const selectedTheme = localStorage.getItem('selected-theme');
const selectedIcon = localStorage.getItem('selected-icon');

const getCurrentTheme = () => document.body.classList.contains(darkTheme) ? 'dark' : 'light';
const getCurrentIcon = () => themeButton.classList.contains('ri-sun-line') ? 'ri-sun-line' : 'ri-moon-line';

if (selectedTheme) {
  document.body.classList[selectedTheme === 'dark' ? 'add' : 'remove'](darkTheme);
  themeButton.classList[selectedIcon === 'ri-sun-line' ? 'add' : 'remove']('ri-sun-line');
  themeButton.classList[selectedIcon === 'ri-moon-line' ? 'add' : 'remove']('ri-moon-line');
}

themeButton.addEventListener('click', () => {
    document.body.classList.toggle(darkTheme);
    
    if(document.body.classList.contains(darkTheme)){
        themeButton.classList.remove('ri-moon-line');
        themeButton.classList.add('ri-sun-line');
    } else {
        themeButton.classList.remove('ri-sun-line');
        themeButton.classList.add('ri-moon-line');
    }

    localStorage.setItem('selected-theme', getCurrentTheme());
    localStorage.setItem('selected-icon', getCurrentIcon());
});

/* =============== PARALLAX & CURSOR =============== */
// Simple Parallax for Hero Image
document.addEventListener('mousemove', (e) => {
    const heroImg = document.querySelector('.hero__img');
    const floating = document.querySelector('.floating-card');
    
    if(heroImg && window.innerWidth > 768) {
        const x = (window.innerWidth - e.pageX * 2) / 100;
        const y = (window.innerHeight - e.pageY * 2) / 100;
        
        heroImg.style.transform = `scale(1.2) translateX(${x}px) translateY(${y}px)`;
        if(floating) floating.style.transform = `translateX(${x * 2}px) translateY(${y * 2}px)`;
    }
});

// Custom Cursor
const cursorDot = document.getElementById('cursor-dot');
const cursorOutline = document.getElementById('cursor-outline');

if(cursorDot && cursorOutline && window.matchMedia("(pointer: fine)").matches) {
    window.addEventListener('mousemove', (e) => {
        const posX = e.clientX;
        const posY = e.clientY;

        cursorDot.style.left = `${posX}px`;
        cursorDot.style.top = `${posY}px`;

        // Slight delay for outline
        cursorOutline.animate({
            left: `${posX}px`,
            top: `${posY}px`
        }, { duration: 500, fill: "forwards" });
    });

    // Hover effect
    document.querySelectorAll('a, button, .category__item, .product-card').forEach(el => {
        el.addEventListener('mouseenter', () => {
            cursorOutline.style.transform = 'translate(-50%, -50%) scale(1.5)';
            cursorOutline.style.backgroundColor = 'rgba(0,0,0,0.1)';
        });
        el.addEventListener('mouseleave', () => {
            cursorOutline.style.transform = 'translate(-50%, -50%) scale(1)';
            cursorOutline.style.backgroundColor = 'transparent';
        });
    });
}

// Scroll Reveal
const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if(entry.isIntersecting){
            entry.target.classList.add('visible');
            entry.target.style.opacity = '1';
            entry.target.style.transform = 'translateY(0)';
        }
    });
}, { threshold: 0.1 });

document.querySelectorAll('.section__title, .product-card, .feature__card').forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(30px)';
    el.style.transition = 'all 0.8s ease-out';
    observer.observe(el);
});
