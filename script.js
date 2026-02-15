/* =============== DATA =============== */
let products = [];
const API_URL = '/api';
const productGrid = document.getElementById('product-grid');
const pageCategory = document.body.getAttribute('data-page');

async function fetchProducts() {
    try {
        const response = await fetch(`${API_URL}/products`);
        if (!response.ok) throw new Error('Failed to fetch products');
        products = await response.json();
        renderProducts();
    } catch (error) {
        console.error('Error loading products:', error);
        const grid = document.getElementById('product-grid');
        if (grid) {
            grid.innerHTML = `<p class="center-text">Error loading products. Please try again later.</p>`;
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
        this.renderCart();
        this.updateCount();
    }

    add(productId) {
        const product = products.find(p => p.id === productId);
        if (!product) return;

        const existingItem = this.cart.find(item => item.id === productId);
        if (existingItem) {
            existingItem.qty++;
        } else {
            this.cart.push({ ...product, qty: 1 });
        }

        this.save();
        this.renderCart();
        this.updateCount();
        this.showFeedback();
    }

    remove(productId) {
        this.cart = this.cart.filter(item => item.id !== productId);
        this.save();
        this.renderCart();
        this.updateCount();
    }

    updateQty(productId, change) {
        const item = this.cart.find(item => item.id === productId);
        if (!item) return;

        item.qty += change;
        if (item.qty <= 0) {
            this.remove(productId);
        } else {
            this.save();
            this.renderCart();
            this.updateCount();
        }
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

        this.cartContent.innerHTML = this.cart.map(item => `
            <div class="cart__item">
                <img src="${item.image}" alt="${item.name}" class="cart__img">
                <div class="cart__item-info">
                    <h4>${item.name}</h4>
                    <span class="cart__item-price">$${item.price.toFixed(2)}</span>
                    <div class="cart__item-actions">
                        <button class="cart__qty-btn" onclick="cart.updateQty(${item.id}, -1)">-</button>
                        <span>${item.qty}</span>
                        <button class="cart__qty-btn" onclick="cart.updateQty(${item.id}, 1)">+</button>
                    </div>
                </div>
                <div class="cart__remove" onclick="cart.remove(${item.id})">
                    <i class="ri-delete-bin-line"></i>
                </div>
            </div>
        `).join('');
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
            filtered = filtered.filter(p => p.best_seller === 1 || p.best_seller === true);
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
        productGrid.innerHTML = `
            <div class="center-text" style="grid-column: 1/-1; padding: 4rem 0;">
                <p>No products found matching your selection.</p>
                <button class="button button--small" style="margin-top: 1rem" onclick="resetFilters()">Clear Filters</button>
            </div>
        `;
        return;
    }

    productGrid.innerHTML = productsToRender.map(product => `
        <article class="product-card">
            <div class="product__img-box">
                <img src="${product.image}" alt="${product.name}" class="product__img">
                <div class="product__actions">
                    <button class="add-to-cart-btn" onclick="cart.add(${product.id})">
                        Add to Cart - $${product.price}
                    </button>
                </div>
            </div>
            <div class="product__info">
                <div>
                    <h3 class="product__title">${product.name}</h3>
                    <span class="product__category">${product.category}</span>
                </div>
                <span class="product__price">$${product.price}</span>
            </div>
        </article>
    `).join('');
    
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
    cartSidebar.classList.toggle('open');
    cartOverlay.classList.toggle('open');
}

if(cartBtn) cartBtn.addEventListener('click', toggleCart);
if(cartClose) cartClose.addEventListener('click', toggleCart);
if(cartOverlay) cartOverlay.addEventListener('click', toggleCart);

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
