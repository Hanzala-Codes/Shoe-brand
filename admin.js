const API_URL = 'http://localhost:3000/api';

const CUSTOMER_BADGE_LABELS = {
    new: 'New',
    returning: 'Returning',
    vip: 'VIP',
    inactive: 'Inactive'
};

const customerFilters = {
    search: '',
    category: 'all',
    sortBy: 'lastOrderDate',
    sortDir: 'desc',
    page: 1,
    limit: 10
};

const customerOrdersState = {
    customerId: null,
    page: 1,
    limit: 5
};

let isEditing = false;
let currentProductId = null;
let productsCache = [];
let customersCache = [];

const tabLinks = document.querySelectorAll('.sidebar__link[data-tab]');
const productsTableBody = document.getElementById('products-table-body');
const ordersTableBody = document.getElementById('orders-table-body');
const customersTableBody = document.getElementById('customers-table-body');
const productModal = document.getElementById('product-modal');
const productForm = document.getElementById('product-form');
const addProductBtn = document.getElementById('add-product-btn');
const closeProductModalBtn = document.querySelector('#product-modal .modal__close');
const modalTitle = document.getElementById('modal-title');
const customerSearchInput = document.getElementById('customer-search');
const customerCategoryFilter = document.getElementById('customer-category-filter');
const customerSortBy = document.getElementById('customer-sort-by');
const customerSortDir = document.getElementById('customer-sort-dir');
const customerPageSize = document.getElementById('customer-page-size');
const customersSummary = document.getElementById('customers-summary');
const customersPagination = document.getElementById('customers-pagination');
const customerOrdersModal = document.getElementById('customer-orders-modal');
const customerOrdersClose = document.getElementById('customer-orders-close');
const customerOrdersTitle = document.getElementById('customer-orders-title');
const customerOrdersSubtitle = document.getElementById('customer-orders-subtitle');
const customerOrdersTableBody = document.getElementById('customer-orders-table-body');
const customerOrdersPagination = document.getElementById('customer-orders-pagination');

// Color Mgmt Elements
const colorInput = document.getElementById('p-color-input');
const addColorBtn = document.getElementById('add-color-btn');
const colorsTagsContainer = document.getElementById('p-colors-tags');
const hiddenColorsInput = document.getElementById('p-colors');

let selectedColors = [];

document.addEventListener('DOMContentLoaded', () => {
    loadProducts();
    loadOrders();
    loadCustomers();
    setupEventListeners();
});

function setupEventListeners() {
    tabLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetTab = link.dataset.tab;

            tabLinks.forEach(item => item.classList.remove('active'));
            link.classList.add('active');

            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.remove('active');
            });

            const targetContent = document.getElementById(`${targetTab}-tab`);
            if (targetContent) {
                targetContent.classList.add('active');
            }

            if (targetTab === 'customers') {
                loadCustomers();
            } else if (targetTab === 'orders') {
                loadOrders();
            }
        });
    });

    if (addProductBtn) {
        addProductBtn.addEventListener('click', openAddModal);
    }

    if (closeProductModalBtn) {
        closeProductModalBtn.addEventListener('click', closeProductModal);
    }

    window.addEventListener('click', (e) => {
        if (e.target === productModal) closeProductModal();
        if (e.target === customerOrdersModal) closeCustomerOrdersModal();
    });

    if (productForm) {
        productForm.addEventListener('submit', handleFormSubmit);
    }

    if (ordersTableBody) {
        ordersTableBody.addEventListener('change', handleOrderStatusChange);
    }

    if (customerSearchInput) {
        customerSearchInput.addEventListener('input', debounce(() => {
            customerFilters.search = customerSearchInput.value.trim();
            customerFilters.page = 1;
            loadCustomers();
        }, 300));
    }

    if (customerCategoryFilter) {
        customerCategoryFilter.addEventListener('change', () => {
            customerFilters.category = customerCategoryFilter.value;
            customerFilters.page = 1;
            loadCustomers();
        });
    }

    if (customerSortBy) {
        customerSortBy.addEventListener('change', () => {
            customerFilters.sortBy = customerSortBy.value;
            customerFilters.page = 1;
            loadCustomers();
        });
    }

    if (customerSortDir) {
        customerSortDir.addEventListener('change', () => {
            customerFilters.sortDir = customerSortDir.value;
            customerFilters.page = 1;
            loadCustomers();
        });
    }

    if (customerPageSize) {
        customerPageSize.addEventListener('change', () => {
            customerFilters.limit = Number(customerPageSize.value) || 10;
            customerFilters.page = 1;
            loadCustomers();
        });
    }

    if (customersTableBody) {
        customersTableBody.addEventListener('click', handleCustomerTableClick);
        customersTableBody.addEventListener('change', handleCustomerCategoryChange);
    }

    if (customersPagination) {
        customersPagination.addEventListener('click', handleCustomerPaginationClick);
    }

    if (customerOrdersPagination) {
        customerOrdersPagination.addEventListener('click', handleCustomerOrdersPaginationClick);
    }

    if (customerOrdersClose) {
        customerOrdersClose.addEventListener('click', closeCustomerOrdersModal);
    }

    if (addColorBtn) {
        addColorBtn.addEventListener('click', () => {
            const color = colorInput.value.trim();
            if (color) addColorTag(color);
        });
    }

    if (colorInput) {
        colorInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const color = colorInput.value.trim();
                if (color) addColorTag(color);
            }
        });
    }
}

function addColorTag(color) {
    if (selectedColors.includes(color)) {
        colorInput.value = '';
        return;
    }

    selectedColors.push(color);
    renderColorTags();
    colorInput.value = '';
    updateHiddenColors();
}

function removeColorTag(color) {
    selectedColors = selectedColors.filter(c => c !== color);
    renderColorTags();
    updateHiddenColors();
}

function renderColorTags() {
    colorsTagsContainer.innerHTML = selectedColors.map(color => `
        <div class="color-tag">
            <span>${escapeHtml(color)}</span>
            <span class="color-tag__remove" onclick="removeColorTag('${escapeHtml(color)}')">&times;</span>
        </div>
    `).join('');
}

function updateHiddenColors() {
    hiddenColorsInput.value = JSON.stringify(selectedColors);
}

window.removeColorTag = removeColorTag;

function debounce(callback, waitMs) {
    let timeoutId = null;
    return (...args) => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => callback(...args), waitMs);
    };
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatCurrency(amount) {
    const value = Number(amount || 0);
    return `$${value.toFixed(2)}`;
}

function formatCustomerCurrency(amount) {
    const value = Number(amount || 0);
    return new Intl.NumberFormat('en-PK', {
        style: 'currency',
        currency: 'PKR',
        maximumFractionDigits: 0
    }).format(value);
}

function formatDate(dateValue) {
    if (!dateValue) return 'N/A';
    const parsed = new Date(dateValue);
    if (Number.isNaN(parsed.getTime())) return 'N/A';
    return parsed.toLocaleDateString();
}

function renderEmptyRow(columnCount, message) {
    return `<tr><td colspan="${columnCount}" class="table-empty">${message}</td></tr>`;
}

/* ================= PRODUCTS ================= */

async function loadProducts() {
    try {
        const response = await fetch(`${API_URL}/products`, { credentials: 'include' });
        if (!response.ok) throw new Error('Failed to fetch products');
        productsCache = await response.json();
        renderProducts(productsCache);
    } catch (error) {
        console.error('Error loading products:', error);
        productsTableBody.innerHTML = renderEmptyRow(6, 'Error loading products');
    }
}

function renderProducts(products) {
    if (!products.length) {
        productsTableBody.innerHTML = renderEmptyRow(6, 'No products found');
        return;
    }

    productsTableBody.innerHTML = products.map(product => `
        <tr>
            <td>
                <img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}" class="product-thumb" onerror="this.src='assets/img/placeholder.png'">
            </td>
            <td><strong>${escapeHtml(product.name)}</strong></td>
            <td>${escapeHtml(product.category)}</td>
            <td>${formatCurrency(product.price)}</td>
            <td>${Number(product.stock || 0)}</td>
            <td>
                <button class="action-btn edit" data-action="edit-product" data-id="${product.id}">
                    <i class="ri-edit-line"></i>
                </button>
                <button class="action-btn delete" data-action="delete-product" data-id="${product.id}">
                    <i class="ri-delete-bin-line"></i>
                </button>
            </td>
        </tr>
    `).join('');

    productsTableBody.querySelectorAll('[data-action="edit-product"]').forEach(button => {
        button.addEventListener('click', () => openEditModal(Number(button.dataset.id)));
    });

    productsTableBody.querySelectorAll('[data-action="delete-product"]').forEach(button => {
        button.addEventListener('click', () => deleteProduct(Number(button.dataset.id)));
    });
}

async function handleFormSubmit(e) {
    e.preventDefault();

    const formData = new FormData();
    formData.append('name', document.getElementById('p-name').value);
    formData.append('category', document.getElementById('p-category').value);
    formData.append('price', document.getElementById('p-price').value);
    formData.append('stock', document.getElementById('p-stock').value);
    formData.append('description', document.getElementById('p-description').value);

    // Get selected sizes
    const selectedSizes = Array.from(document.querySelectorAll('#p-sizes-group input:checked')).map(cb => cb.value);
    formData.append('sizes', JSON.stringify(selectedSizes));

    // Get colors (already updated in selectedColors array)
    formData.append('colors', JSON.stringify(selectedColors));

    const fileInput = document.getElementById('p-image-file');
    const urlInput = document.getElementById('p-image-url');

    if (fileInput.files[0]) {
        formData.append('image', fileInput.files[0]);
    } else {
        formData.append('imageUrl', urlInput.value);
    }

    try {
        const response = await fetch(
            isEditing ? `${API_URL}/products/${currentProductId}` : `${API_URL}/products`,
            {
                method: isEditing ? 'PUT' : 'POST',
                body: formData,
                credentials: 'include'
            }
        );

        if (!response.ok) throw new Error('Operation failed');

        closeProductModal();
        await loadProducts();
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
    
    // Clear checkboxes
    document.querySelectorAll('#p-sizes-group input').forEach(cb => cb.checked = false);
    
    // Clear colors
    selectedColors = [];
    renderColorTags();
    updateHiddenColors();
    
    productModal.classList.add('open');
}

async function openEditModal(id) {
    try {
        const product = productsCache.find(item => item.id === id);
        if (!product) throw new Error('Product not found');

        isEditing = true;
        currentProductId = id;
        modalTitle.textContent = 'Edit Product';

        document.getElementById('p-name').value = product.name;
        document.getElementById('p-category').value = product.category;
        document.getElementById('p-price').value = product.price;
        document.getElementById('p-stock').value = product.stock;
        document.getElementById('p-description').value = product.description || '';
        
        // Helper to safely parse JSON or return array
        const safeParse = (data) => {
            if (!data) return [];
            if (Array.isArray(data)) return data;
            try { return JSON.parse(data); } catch(e) { return []; }
        };

        // Set sizes
        const sizes = safeParse(product.sizes);
        document.querySelectorAll('#p-sizes-group input').forEach(cb => {
            cb.checked = sizes.includes(cb.value);
        });

        // Set colors
        selectedColors = safeParse(product.colors);
        renderColorTags();
        updateHiddenColors();

        document.getElementById('p-image-file').value = '';
        document.getElementById('p-image-url').value = product.image || '';

        productModal.classList.add('open');
    } catch (error) {
        console.error(error);
        alert('Could not load product details.');
    }
}

async function deleteProduct(id) {
    if (!confirm('Are you sure you want to delete this product?')) return;

    try {
        const response = await fetch(`${API_URL}/products/${id}`, {
            method: 'DELETE',
            credentials: 'include'
        });

        if (!response.ok) throw new Error('Delete failed');

        await loadProducts();
    } catch (error) {
        console.error(error);
        alert('Error deleting product.');
    }
}

function closeProductModal() {
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
        ordersTableBody.innerHTML = renderEmptyRow(7, 'Error loading orders');
    }
}

function renderOrders(orders) {
    if (!orders.length) {
        ordersTableBody.innerHTML = renderEmptyRow(7, 'No orders found');
        return;
    }

    ordersTableBody.innerHTML = orders.map(order => {
        const itemsList = order.items.map(item => `
            <div class="order-item">
                <span class="order-item__qty">${Number(item.qty || 0)}x</span> 
                <span class="order-item__name">${escapeHtml(item.name)}</span>
                ${item.size || item.color ? `
                    <div class="order-item__variant">
                        ${item.size ? `Size: ${item.size}` : ''} 
                        ${item.color ? `| Color: ${item.color}` : ''}
                    </div>
                ` : ''}
            </div>
        `).join('');

        return `
            <tr>
                <td>#${order.id}</td>
                <td>
                    <strong>${escapeHtml(order.customer_name)}</strong><br>
                    <small>${escapeHtml(order.email || 'No email')}</small>
                </td>
                <td>
                    ${escapeHtml(order.phone)}<br>
                    <small>${escapeHtml(order.address)}</small>
                </td>
                <td>${itemsList}</td>
                <td>${formatCurrency(order.total_amount)}</td>
                <td>
                    <select class="status-select" data-id="${order.id}">
                        ${['Pending', 'Processing', 'Shipped', 'Completed', 'Cancelled'].map(status => `
                            <option value="${status}" ${order.status === status ? 'selected' : ''}>${status}</option>
                        `).join('')}
                    </select>
                </td>
                <td>${formatDate(order.created_at)}</td>
            </tr>
        `;
    }).join('');
}

async function handleOrderStatusChange(event) {
    const select = event.target.closest('.status-select');
    if (!select) return;

    const id = select.getAttribute('data-id');
    const status = select.value;

    try {
        const response = await fetch(`${API_URL}/orders/${id}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status }),
            credentials: 'include'
        });

        if (!response.ok) throw new Error('Failed to update status');
        await loadOrders();
    } catch (error) {
        console.error(error);
        alert('Could not update order status.');
    }
}

/* ================= CUSTOMERS ================= */

async function loadCustomers() {
    try {
        customersTableBody.innerHTML = renderEmptyRow(7, 'Loading customers...');

        const query = new URLSearchParams({
            search: customerFilters.search,
            category: customerFilters.category,
            sortBy: customerFilters.sortBy,
            sortDir: customerFilters.sortDir,
            page: String(customerFilters.page),
            limit: String(customerFilters.limit)
        });

        const response = await fetch(`${API_URL}/customers?${query.toString()}`, {
            credentials: 'include'
        });

        if (!response.ok) throw new Error('Failed to fetch customers');

        const payload = await response.json();
        customersCache = payload.items || [];
        renderCustomers(customersCache);
        renderCustomersPagination(payload.pagination);
        renderCustomersSummary(payload.pagination);
    } catch (error) {
        console.error('Error loading customers:', error);
        customersTableBody.innerHTML = renderEmptyRow(7, 'Error loading customers');
        customersPagination.innerHTML = '';
        if (customersSummary) {
            customersSummary.textContent = '';
        }
    }
}

function renderCustomers(customers) {
    if (!customers.length) {
        customersTableBody.innerHTML = renderEmptyRow(7, 'No customers match the selected filters');
        return;
    }

    customersTableBody.innerHTML = customers.map(customer => `
        <tr>
            <td>
                <strong>${escapeHtml(customer.name)}</strong><br>
                <small>${escapeHtml(customer.email || 'No email')}</small>
            </td>
            <td>${escapeHtml(customer.phone)}</td>
            <td>${Number(customer.totalOrders || 0)}</td>
            <td>${formatCustomerCurrency(customer.totalSpent)}</td>
            <td>${formatDate(customer.lastOrderDate)}</td>
            <td>
                <div class="category-cell">
                    <span class="badge badge--customer badge--${escapeHtml(customer.category)}">${CUSTOMER_BADGE_LABELS[customer.category] || customer.category}</span>
                    <small class="category-meta">${customer.categorySource === 'manual' ? 'Manual override' : 'Auto rule'}</small>
                </div>
            </td>
            <td>
                <div class="table-actions">
                    <select class="table-select customer-category-select" data-id="${customer.id}">
                        <option value="auto" ${customer.categoryOverride ? '' : 'selected'}>Auto</option>
                        <option value="new" ${customer.categoryOverride === 'new' ? 'selected' : ''}>New</option>
                        <option value="returning" ${customer.categoryOverride === 'returning' ? 'selected' : ''}>Returning</option>
                        <option value="vip" ${customer.categoryOverride === 'vip' ? 'selected' : ''}>VIP</option>
                        <option value="inactive" ${customer.categoryOverride === 'inactive' ? 'selected' : ''}>Inactive</option>
                    </select>
                    <button class="btn btn--secondary btn--small" data-action="view-customer-orders" data-id="${customer.id}">
                        View Orders
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

function renderCustomersPagination(pagination) {
    if (!pagination || pagination.totalPages <= 1) {
        customersPagination.innerHTML = '';
        return;
    }

    customersPagination.innerHTML = `
        <button class="btn btn--secondary btn--small" data-page="${pagination.page - 1}" ${pagination.page <= 1 ? 'disabled' : ''}>Previous</button>
        <span class="pagination__info">Page ${pagination.page} of ${pagination.totalPages}</span>
        <button class="btn btn--secondary btn--small" data-page="${pagination.page + 1}" ${pagination.page >= pagination.totalPages ? 'disabled' : ''}>Next</button>
    `;
}

function renderCustomersSummary(pagination) {
    if (!customersSummary || !pagination) return;

    if (!pagination.total) {
        customersSummary.textContent = 'No customers found for the selected filters.';
        return;
    }

    const start = (pagination.page - 1) * pagination.limit + 1;
    const end = Math.min(pagination.page * pagination.limit, pagination.total);
    customersSummary.textContent = `Showing ${start}-${end} of ${pagination.total} customers`;
}

async function handleCustomerCategoryChange(event) {
    const select = event.target.closest('.customer-category-select');
    if (!select) return;

    try {
        const response = await fetch(`${API_URL}/customers/${select.dataset.id}/category`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ category: select.value }),
            credentials: 'include'
        });

        if (!response.ok) {
            const errorPayload = await response.json().catch(() => ({}));
            throw new Error(errorPayload.error || 'Failed to update customer category');
        }

        await loadCustomers();
    } catch (error) {
        console.error(error);
        alert(error.message || 'Could not update customer category.');
        loadCustomers();
    }
}

function handleCustomerTableClick(event) {
    const button = event.target.closest('[data-action="view-customer-orders"]');
    if (!button) return;

    const customerId = Number(button.dataset.id);
    openCustomerOrdersModal(customerId);
}

function handleCustomerPaginationClick(event) {
    const button = event.target.closest('[data-page]');
    if (!button || button.disabled) return;

    customerFilters.page = Number(button.dataset.page);
    loadCustomers();
}

async function openCustomerOrdersModal(customerId) {
    customerOrdersState.customerId = customerId;
    customerOrdersState.page = 1;
    customerOrdersModal.classList.add('open');
    await loadCustomerOrders();
}

function closeCustomerOrdersModal() {
    customerOrdersModal.classList.remove('open');
    customerOrdersTableBody.innerHTML = '';
    customerOrdersPagination.innerHTML = '';
    customerOrdersTitle.textContent = 'Customer Orders';
    customerOrdersSubtitle.textContent = '';
}

async function loadCustomerOrders() {
    if (!customerOrdersState.customerId) return;

    try {
        const query = new URLSearchParams({
            page: String(customerOrdersState.page),
            limit: String(customerOrdersState.limit)
        });

        const response = await fetch(
            `${API_URL}/customers/${customerOrdersState.customerId}/orders?${query.toString()}`,
            { credentials: 'include' }
        );

        if (!response.ok) throw new Error('Failed to load customer orders');
        const payload = await response.json();

        customerOrdersTitle.textContent = `${payload.customer.name} - Orders`;
        customerOrdersSubtitle.textContent = `${payload.customer.phone} | ${payload.customer.totalOrders} total orders | ${formatCustomerCurrency(payload.customer.totalSpent)} spent`;

        renderCustomerOrders(payload.orders || []);
        renderCustomerOrdersPagination(payload.pagination);
    } catch (error) {
        console.error(error);
        customerOrdersTableBody.innerHTML = renderEmptyRow(5, 'Could not load customer orders');
        customerOrdersPagination.innerHTML = '';
    }
}

function renderCustomerOrders(orders) {
    if (!orders.length) {
        customerOrdersTableBody.innerHTML = renderEmptyRow(5, 'No orders found for this customer');
        return;
    }

    customerOrdersTableBody.innerHTML = orders.map(order => `
        <tr>
            <td>#${order.id}</td>
            <td>${formatDate(order.created_at)}</td>
            <td>
                ${order.items.map(item => `
                    <div class="order-item">
                        <span class="order-item__qty">${Number(item.qty || 0)}x</span> 
                        <span class="order-item__name">${escapeHtml(item.name)}</span>
                        ${item.size || item.color ? `
                            <div class="order-item__variant">
                                ${item.size ? `Size: ${item.size}` : ''} 
                                ${item.color ? `| Color: ${item.color}` : ''}
                            </div>
                        ` : ''}
                    </div>
                `).join('')}
            </td>
            <td>${formatCustomerCurrency(order.total_amount)}</td>
            <td><span class="badge badge--order badge--${String(order.status || '').toLowerCase()}">${escapeHtml(order.status)}</span></td>
        </tr>
    `).join('');
}

function renderCustomerOrdersPagination(pagination) {
    if (!pagination || pagination.totalPages <= 1) {
        customerOrdersPagination.innerHTML = '';
        return;
    }

    customerOrdersPagination.innerHTML = `
        <button class="btn btn--secondary btn--small" data-page="${pagination.page - 1}" ${pagination.page <= 1 ? 'disabled' : ''}>Previous</button>
        <span class="pagination__info">Page ${pagination.page} of ${pagination.totalPages}</span>
        <button class="btn btn--secondary btn--small" data-page="${pagination.page + 1}" ${pagination.page >= pagination.totalPages ? 'disabled' : ''}>Next</button>
    `;
}

function handleCustomerOrdersPaginationClick(event) {
    const button = event.target.closest('[data-page]');
    if (!button || button.disabled) return;

    customerOrdersState.page = Number(button.dataset.page);
    loadCustomerOrders();
}
