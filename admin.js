const API_URL = 'http://localhost:3000/api';

// DOM Elements
const productsTab = document.getElementById('products-tab');
const ordersTab = document.getElementById('orders-tab');
const tabLinks = document.querySelectorAll('.sidebar__link[data-tab]');
const productsTableBody = document.getElementById('products-table-body');
const ordersTableBody = document.getElementById('orders-table-body');
const productModal = document.getElementById('product-modal');
const productForm = document.getElementById('product-form');
const addProductBtn = document.getElementById('add-product-btn');
const closeModalBtn = document.querySelector('.modal__close');
const modalTitle = document.getElementById('modal-title');

// State
let isEditing = false;
let currentProductId = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadProducts();
    loadOrders();
    setupEventListeners();
});

function setupEventListeners() {
    // Tab Switching
    tabLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetTab = link.dataset.tab;
            
            // Update Sidebar Active State
            tabLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');

            // Show Target Content
            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.remove('active');
            });
            document.getElementById(`${targetTab}-tab`).classList.add('active');
        });
    });

    // Modal Controls
    addProductBtn.addEventListener('click', openAddModal);
    closeModalBtn.addEventListener('click', closeModal);
    window.addEventListener('click', (e) => {
        if (e.target === productModal) closeModal();
    });

    // Form Submission
    productForm.addEventListener('submit', handleFormSubmit);
}

/* ================= PRODUCTS ================= */

async function loadProducts() {
    try {
        const response = await fetch(`${API_URL}/products`, { credentials: 'include' });
        const products = await response.json();
        renderProducts(products);
    } catch (error) {
        console.error('Error loading products:', error);
        productsTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:red;">Error loading products</td></tr>`;
    }
}

function renderProducts(products) {
    productsTableBody.innerHTML = products.map(product => `
        <tr>
            <td>
                <img src="${product.image}" alt="${product.name}" class="product-thumb" onerror="this.src='assets/img/placeholder.png'">
            </td>
            <td><strong>${product.name}</strong></td>
            <td>${product.category}</td>
            <td>$${product.price}</td>
            <td>${product.stock}</td>
            <td>
                <button class="action-btn edit" onclick="openEditModal(${product.id})">
                    <i class="ri-edit-line"></i>
                </button>
                <button class="action-btn delete" onclick="deleteProduct(${product.id})">
                    <i class="ri-delete-bin-line"></i>
                </button>
            </td>
        </tr>
    `).join('');
}

async function handleFormSubmit(e) {
    e.preventDefault();
    
    const formData = new FormData();
    formData.append('name', document.getElementById('p-name').value);
    formData.append('category', document.getElementById('p-category').value);
    formData.append('price', document.getElementById('p-price').value);
    formData.append('stock', document.getElementById('p-stock').value);
    formData.append('description', document.getElementById('p-description').value);
    
    const fileInput = document.getElementById('p-image-file');
    const urlInput = document.getElementById('p-image-url');

    if (fileInput.files[0]) {
        formData.append('image', fileInput.files[0]);
    } else {
        formData.append('imageUrl', urlInput.value);
    }

    try {
        let response;
        if (isEditing) {
            response = await fetch(`${API_URL}/products/${currentProductId}`, {
                method: 'PUT',
                body: formData, // Fetch handles Content-Type for FormData
                credentials: 'include'
            });
        } else {
            response = await fetch(`${API_URL}/products`, {
                method: 'POST',
                body: formData,
                credentials: 'include'
            });
        }

        if (!response.ok) throw new Error('Operation failed');

        closeModal();
        loadProducts(); // Refresh list
        alert(isEditing ? 'Product updated successfully!' : 'Product added successfully!');
    } catch (error) {
        console.error('Error saving product:', error);
        alert('Error saving product. Please check console for details.');
    }
}

function openAddModal() {
    isEditing = false;
    currentProductId = null;
    modalTitle.textContent = 'Add New Product';
    productForm.reset();
    productModal.classList.add('open');
}

window.openEditModal = async function(id) {
    try {
        // Fetch single product details (or find in existing list if optimized)
        // For now, let's fetch list again or filter from DOM? Better to fetch fresh.
        // Since we don't have GET /products/:id, we'll find it from the full list we already have? 
        // Actually, fetching all is cheap for now. Or we can just grab from the row data if we stored it?
        // Let's just fetch all again and find it, or add GET /products/:id endpoint.
        // Simplest: Find in the currently rendered list (if we had it in a global var).
        
        // Let's quickly add GET /products/:id to server or just filter from client side.
        // Client side filter:
        const response = await fetch(`${API_URL}/products`);
        const products = await response.json();
        const product = products.find(p => p.id === id);
        
        if (!product) throw new Error('Product not found');

        isEditing = true;
        currentProductId = id;
        modalTitle.textContent = 'Edit Product';

        document.getElementById('p-name').value = product.name;
        document.getElementById('p-category').value = product.category;
        document.getElementById('p-price').value = product.price;
        document.getElementById('p-stock').value = product.stock;
        document.getElementById('p-description').value = product.description || '';
        document.getElementById('p-image-url').value = product.image; // Pre-fill URL if it's a URL
        
        productModal.classList.add('open');
    } catch (error) {
        console.error(error);
        alert('Could not load product details.');
    }
};

window.deleteProduct = async function(id) {
    if (!confirm('Are you sure you want to delete this product?')) return;

    try {
        const response = await fetch(`${API_URL}/products/${id}`, {
            method: 'DELETE',
            credentials: 'include'
        });

        if (!response.ok) throw new Error('Delete failed');

        loadProducts();
    } catch (error) {
        console.error(error);
        alert('Error deleting product.');
    }
};

function closeModal() {
    productModal.classList.remove('open');
}

/* ================= ORDERS ================= */

async function loadOrders() {
    try {
        const response = await fetch(`${API_URL}/orders`, { credentials: 'include' });
        if (!response.ok) throw new Error('Failed to fetch orders');
        const orders = await response.json();
        renderOrders(orders);
    } catch (error) {
        console.error('Error loading orders:', error);
        ordersTableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:red;">Error loading orders</td></tr>`;
    }
}

function renderOrders(orders) {
    ordersTableBody.innerHTML = orders.map(order => {
        const itemsList = order.items.map(item => 
            `<div>${item.qty}x ${item.name}</div>`
        ).join('');
        
        return `
        <tr>
            <td>#${order.id}</td>
            <td>
                <strong>${order.customer_name}</strong><br>
                <small>${order.email || ''}</small>
            </td>
            <td>
                ${order.phone}<br>
                <small>${order.address}</small>
            </td>
            <td>${itemsList}</td>
            <td>$${order.total_amount}</td>
            <td>
                <select class="status-select" data-id="${order.id}">
                    ${['Pending','Processing','Shipped','Completed','Cancelled'].map(s => `
                        <option value="${s}" ${order.status === s ? 'selected' : ''}>${s}</option>
                    `).join('')}
                </select>
            </td>
            <td>${new Date(order.created_at).toLocaleDateString()}</td>
        </tr>
    `}).join('');
    
    // Attach change listeners
    document.querySelectorAll('.status-select').forEach(sel => {
        sel.addEventListener('change', async (e) => {
            const id = e.target.getAttribute('data-id');
            const status = e.target.value;
            try {
                const resp = await fetch(`${API_URL}/orders/${id}/status`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status }),
                    credentials: 'include'
                });
                if (!resp.ok) throw new Error('Failed to update status');
                loadOrders();
            } catch (err) {
                console.error(err);
                alert('Could not update order status.');
            }
        });
    });
}
