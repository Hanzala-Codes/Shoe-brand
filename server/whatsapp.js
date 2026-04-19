const twilio = require('twilio');

const WHATSAPP_PREFIX = 'whatsapp:';

function isFeatureEnabled(value) {
    if (typeof value === 'undefined' || value === null || value === '') {
        return false;
    }

    return !['0', 'false', 'no', 'off'].includes(String(value).trim().toLowerCase());
}

function normalizeWhatsappAddress(value) {
    if (!value) return '';

    const trimmed = String(value).trim();
    if (!trimmed) return '';

    if (trimmed.startsWith(WHATSAPP_PREFIX)) {
        return trimmed;
    }

    const normalizedNumber = trimmed.replace(/[^\d+]/g, '');
    return normalizedNumber ? `${WHATSAPP_PREFIX}${normalizedNumber}` : '';
}

function getItemQuantity(item) {
    const quantity = Number(item && (item.qty ?? item.quantity ?? 0));
    return Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
}

function getItemName(item, index) {
    const name = item && item.name ? String(item.name).trim() : '';
    return name || `Item ${index + 1}`;
}

function formatAmount(amount) {
    const numericAmount = Number(amount);
    return Number.isFinite(numericAmount) ? numericAmount.toFixed(2) : String(amount || '0');
}

function buildOrderWhatsAppMessage(order) {
    const items = Array.isArray(order.items) ? order.items : [];
    const itemLines = items.length
        ? items.map((item, index) => `- ${getItemName(item, index)} x${getItemQuantity(item)}`).join('\n')
        : '- No items provided';

    return [
        'New order received',
        `Order ID: ${order.orderId}`,
        `Customer Name: ${order.customer_name || 'N/A'}`,
        `Phone Number: ${order.phone || 'N/A'}`,
        `Address: ${order.address || 'N/A'}`,
        'Ordered Products:',
        itemLines,
        `Total Amount: ${formatAmount(order.total_amount)}`
    ].join('\n');
}

function getWhatsAppConfig() {
    return {
        enabled: isFeatureEnabled(process.env.WHATSAPP_NOTIFICATIONS_ENABLED),
        accountSid: process.env.TWILIO_ACCOUNT_SID || '',
        authToken: process.env.TWILIO_AUTH_TOKEN || '',
        from: normalizeWhatsappAddress(process.env.TWILIO_WHATSAPP_FROM),
        to: normalizeWhatsappAddress(process.env.ORDER_NOTIFICATION_WHATSAPP_TO)
    };
}

function getWhatsAppDiagnostics() {
    const config = getWhatsAppConfig();

    return {
        enabled: config.enabled,
        hasAccountSid: !!config.accountSid,
        hasAuthToken: !!config.authToken,
        hasFrom: !!config.from,
        hasTo: !!config.to
    };
}

let twilioClient = null;
let twilioClientKey = '';

function getTwilioClient(accountSid, authToken) {
    const cacheKey = `${accountSid}:${authToken}`;
    if (!twilioClient || twilioClientKey !== cacheKey) {
        twilioClient = twilio(accountSid, authToken);
        twilioClientKey = cacheKey;
    }

    return twilioClient;
}

async function sendOrderWhatsAppNotification(order) {
    const config = getWhatsAppConfig();

    if (!config.enabled) {
        return { skipped: true, reason: 'disabled' };
    }

    if (!config.accountSid || !config.authToken || !config.from || !config.to) {
        console.warn('WhatsApp notification skipped: Twilio WhatsApp configuration is incomplete.');
        return { skipped: true, reason: 'missing_config' };
    }

    const client = getTwilioClient(config.accountSid, config.authToken);
    const body = buildOrderWhatsAppMessage(order);
    const response = await client.messages.create({
        from: config.from,
        to: config.to,
        body
    });

    return {
        sent: true,
        sid: response.sid
    };
}

module.exports = {
    buildOrderWhatsAppMessage,
    getWhatsAppDiagnostics,
    sendOrderWhatsAppNotification
};
